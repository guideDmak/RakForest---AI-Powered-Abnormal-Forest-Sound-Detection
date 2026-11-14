"""Local FastAPI adapter for the three RakForest audio checkpoints."""

from __future__ import annotations

import io
import os
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import librosa
import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from torch import nn


PROJECT_ROOT = Path(__file__).resolve().parents[1]
CHECKPOINT_PATH = Path(
    os.environ.get(
        "RAKFOREST_CHECKPOINT",
        str(PROJECT_ROOT / "models" / "rakforest_audio_cnn_multilabel_best.pt"),
    )
).expanduser().resolve()
SINGLE_CHECKPOINT_PATH = PROJECT_ROOT / "models" / "rakforest_audio_cnn_singlelabel_retrained_best.pt"
CRNN_CHECKPOINT_PATH = PROJECT_ROOT / "models" / "rakforest_crnn_sigmoid_best.pt"
MAX_AUDIO_BYTES = 20 * 1024 * 1024
BATCH_SIZE = 32
MODEL_VERSIONS = {
    "cnn_softmax": "rakforest-cnn-softmax-gunshot-v2",
    "cnn_sigmoid": "rakforest-cnn-sigmoid-gunshot-v2",
    "crnn_sigmoid": "rakforest-crnn-sigmoid-gunshot-v2",
}
MODEL_LABELS = {
    "cnn_softmax": "CNN + Softmax (Single-label)",
    "cnn_sigmoid": "CNN + Sigmoid (Multi-label)",
    "crnn_sigmoid": "CRNN + Sigmoid (Multi-label)",
}
MODEL_IDS = tuple(MODEL_VERSIONS)
EXPECTED_CLASSES = [
    "fire", "chainsaw", "vehicle", "human_activity", "threat_tactical",
    "gunshot", "weather", "natural_ambient", "silence", "other",
]
CLASS_LABELS = {
    "fire": "เสียงไฟ",
    "chainsaw": "เสียงเลื่อยยนต์",
    "vehicle": "เสียงยานพาหนะ",
    "human_activity": "กิจกรรมมนุษย์",
    "threat_tactical": "กิจกรรมต้องสงสัย",
    "gunshot": "เสียงปืน",
    "weather": "เสียงสภาพอากาศ",
    "natural_ambient": "เสียงธรรมชาติ",
    "silence": "ความเงียบ",
    "other": "เสียงอื่น",
}


class ConvBlock(nn.Module):
    def __init__(self, in_channels: int, out_channels: int):
        super().__init__()
        self.block = nn.Sequential(
            nn.Conv2d(in_channels, out_channels, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.block(x)


class AudioCNN(nn.Module):
    def __init__(self, num_classes: int):
        super().__init__()
        self.features = nn.Sequential(
            ConvBlock(1, 16),
            ConvBlock(16, 32),
            ConvBlock(32, 64),
            ConvBlock(64, 128),
            nn.AdaptiveAvgPool2d((1, 1)),
        )
        self.classifier = nn.Sequential(nn.Flatten(), nn.Dropout(0.35), nn.Linear(128, num_classes))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.classifier(self.features(x))


class CRNNConvBlock(nn.Module):
    def __init__(self, in_channels: int, out_channels: int):
        super().__init__()
        self.block = nn.Sequential(
            nn.Conv2d(in_channels, out_channels, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.block(x)


class CRNN(nn.Module):
    def __init__(self, num_classes: int):
        super().__init__()
        self.features = nn.Sequential(
            CRNNConvBlock(1, 16), CRNNConvBlock(16, 32),
            CRNNConvBlock(32, 64), CRNNConvBlock(64, 128),
        )
        self.gru = nn.GRU(
            input_size=128, hidden_size=64, num_layers=1,
            batch_first=True, bidirectional=True,
        )
        self.dropout = nn.Dropout(0.35)
        self.classifier = nn.Linear(128, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        z = self.features(x)
        z = z.mean(dim=2).transpose(1, 2)
        sequence, _ = self.gru(z)
        return self.classifier(self.dropout(sequence.mean(dim=1)))


def select_device() -> torch.device:
    requested = os.environ.get("RAKFOREST_DEVICE", "auto").lower()
    available = {
        "cpu": True,
        "cuda": torch.cuda.is_available(),
        "mps": bool(getattr(torch.backends, "mps", None) and torch.backends.mps.is_available()),
    }
    if requested == "auto":
        return torch.device("cuda" if available["cuda"] else "mps" if available["mps"] else "cpu")
    if requested not in available or not available[requested]:
        raise RuntimeError(f"RAKFOREST_DEVICE={requested!r} is not available; choose auto, cpu, mps, or cuda")
    return torch.device(requested)


def load_models() -> dict[str, dict[str, Any]]:
    device = select_device()
    paths = {
        "cnn_sigmoid": CHECKPOINT_PATH,
        "cnn_softmax": SINGLE_CHECKPOINT_PATH,
        "crnn_sigmoid": CRNN_CHECKPOINT_PATH,
    }
    bundles: dict[str, dict[str, Any]] = {}
    shared_classes: list[str] | None = None
    shared_config: dict[str, Any] | None = None
    expected_config_keys = {"sample_rate", "duration_seconds", "n_mels", "n_fft", "hop_length"}

    for model_id, path in paths.items():
        if not path.is_file():
            raise FileNotFoundError(f"{MODEL_LABELS[model_id]} checkpoint not found: {path}")
        checkpoint = torch.load(path, map_location="cpu", weights_only=True)
        classes = list(checkpoint.get("class_names", []))
        if classes != EXPECTED_CLASSES:
            raise RuntimeError(f"{MODEL_LABELS[model_id]} checkpoint must use the current 10-class order including gunshot")
        if checkpoint.get("class_to_index", {name: i for i, name in enumerate(classes)}) != {
            name: i for i, name in enumerate(classes)
        }:
            raise RuntimeError(f"{MODEL_LABELS[model_id]} class_to_index does not match class_names")

        config = checkpoint.get("config", {})
        if expected_config_keys.difference(config):
            raise RuntimeError(f"{MODEL_LABELS[model_id]} checkpoint is missing feature config")
        if shared_classes is None:
            shared_classes = classes
            shared_config = config
        else:
            if classes != shared_classes:
                raise RuntimeError("The three model checkpoints use different class orders")
            for key in expected_config_keys:
                if config.get(key) != shared_config.get(key):
                    raise RuntimeError(f"The three model checkpoints do not share preprocessing value {key}")

        if model_id == "cnn_sigmoid":
            if checkpoint.get("model_type") != "multilabel_audio_cnn" or checkpoint.get("schema_version") != "multilabel-v1":
                raise RuntimeError("Candidate checkpoint is not the expected multi-label CNN")
            if not checkpoint.get("manifest_signature") or not checkpoint.get("training_datasets"):
                raise RuntimeError("Candidate checkpoint is missing training provenance")
            if "zenodo_fire" in checkpoint["training_datasets"]:
                raise RuntimeError("Candidate checkpoint includes the quarantined zenodo_fire dataset")
            if config.get("architecture") != "AudioCNN-v2-multilabel" or config.get("output_activation") != "sigmoid":
                raise RuntimeError("Candidate checkpoint architecture or activation is not supported")
            model: nn.Module = AudioCNN(len(classes))
        elif model_id == "cnn_softmax":
            if checkpoint.get("model_type") != "singlelabel_audio_cnn":
                raise RuntimeError("Single-label checkpoint has an unsupported model type")
            if config.get("architecture") != "AudioCNN-v1" or config.get("output_activation") != "softmax":
                raise RuntimeError("Single-label checkpoint architecture or activation is not supported")
            model = AudioCNN(len(classes))
        else:
            if checkpoint.get("model_type") != "multilabel_crnn" or checkpoint.get("schema_version") != "crnn-sigmoid-v1":
                raise RuntimeError("CRNN checkpoint has an unsupported schema")
            if config.get("architecture") != "CRNN-GRU-v1-sigmoid" or config.get("output_activation") != "sigmoid":
                raise RuntimeError("CRNN checkpoint architecture or activation is not supported")
            model = CRNN(len(classes))

        model = model.to(device)
        model.load_state_dict(checkpoint["model_state_dict"])
        model.eval()
        bundles[model_id] = {
            "model": model, "checkpoint": checkpoint, "classes": classes,
            "config": config, "device": device, "model_id": model_id,
        }
    return bundles


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.bundles = load_models()
    yield


app = FastAPI(title="RakForest local audio inference", version="1.0.0", lifespan=lifespan)


@app.get("/health")
def health():
    bundles = getattr(app.state, "bundles", None)
    primary = bundles.get("cnn_sigmoid") if bundles else None
    return {
        "status": "ready" if bundles else "starting",
        "modelVersions": MODEL_VERSIONS,
        "models": [{"id": model_id, "label": MODEL_LABELS[model_id]} for model_id in MODEL_IDS] if bundles else [],
        "classes": primary["classes"] if primary else [],
        "device": str(primary["device"]) if primary else None,
    }


def read_audio_mono(data: bytes) -> tuple[np.ndarray, int]:
    try:
        y, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=False)
        if y.ndim == 2:
            y = y.mean(axis=1)
    except Exception:
        # Match notebook 05's librosa fallback for formats libsndfile cannot decode.
        try:
            y, sr = librosa.load(io.BytesIO(data), sr=None, mono=True, dtype=np.float32)
        except Exception as exc:
            raise ValueError("อ่านไฟล์เสียงไม่ได้ ตรวจสอบไฟล์หรือ codec ที่รองรับ") from exc
    y = np.asarray(y, dtype=np.float32)
    if y.size == 0 or not np.isfinite(y).all():
        raise ValueError("ไฟล์เสียงว่างหรือมีค่าที่ไม่ถูกต้อง")
    return y, int(sr)


def split_windows(
    y: np.ndarray, sample_rate: int, duration_seconds: float
) -> list[tuple[np.ndarray, float, float]]:
    num_samples = int(sample_rate * duration_seconds)
    if len(y) <= num_samples:
        valid_seconds = len(y) / sample_rate
        window = np.pad(y, (0, num_samples - len(y))) if len(y) < num_samples else y
        return [(window, 0.0, valid_seconds)]
    starts = list(range(0, len(y) - num_samples + 1, num_samples))
    final_start = len(y) - num_samples
    if starts[-1] != final_start:
        starts.append(final_start)
    return [(y[start : start + num_samples], start / sample_rate, duration_seconds) for start in starts]


def to_logmel(y: np.ndarray, sample_rate: int, config: dict[str, Any]) -> np.ndarray:
    mel = librosa.feature.melspectrogram(
        y=y,
        sr=sample_rate,
        n_fft=int(config["n_fft"]),
        hop_length=int(config["hop_length"]),
        n_mels=int(config["n_mels"]),
        power=2.0,
    )
    logmel = librosa.power_to_db(mel, ref=np.max)
    return ((logmel - logmel.mean()) / (logmel.std() + 1e-6)).astype(np.float32)


def infer(data: bytes, bundle: dict[str, Any]) -> list[dict[str, Any]]:
    original, original_sr = read_audio_mono(data)
    original -= float(np.mean(original))  # same DC-offset removal as notebook 02/05
    config = bundle["config"]
    sample_rate = int(config["sample_rate"])
    if original_sr != sample_rate:
        original = librosa.resample(original, orig_sr=original_sr, target_sr=sample_rate)
    windows = split_windows(original, sample_rate, float(config["duration_seconds"]))
    segments: list[dict[str, Any]] = []
    model: nn.Module = bundle["model"]
    device: torch.device = bundle["device"]
    with torch.inference_mode():
        for offset in range(0, len(windows), BATCH_SIZE):
            batch = windows[offset : offset + BATCH_SIZE]
            features = np.stack([to_logmel(y, sample_rate, config) for y, _, _ in batch])
            inputs = torch.from_numpy(features).unsqueeze(1).to(device)
            logits = model(inputs)
            if bundle["model_id"] == "cnn_softmax":
                probabilities = torch.softmax(logits, dim=1).cpu().numpy()
            else:
                probabilities = torch.sigmoid(logits).cpu().numpy()
            for local_index, ((_, start_seconds, valid_seconds), row) in enumerate(zip(batch, probabilities)):
                scores = [
                    {
                        "classId": class_id,
                        "label": CLASS_LABELS.get(class_id, class_id),
                        "score": float(row[class_index]),
                    }
                    for class_index, class_id in enumerate(bundle["classes"])
                ]
                segments.append(
                    {
                        "segmentIndex": offset + local_index,
                        "startSeconds": round(start_seconds, 3),
                        "endSeconds": round(start_seconds + valid_seconds, 3),
                        "scores": scores,
                    }
                )
    return segments


@app.post("/analyze")
async def analyze(
    audio: UploadFile = File(...),
    requestId: str = Form(...),
    stationId: str = Form(...),
    modelId: str = Form("cnn_sigmoid"),
):
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", requestId):
        raise HTTPException(status_code=400, detail="requestId รูปแบบไม่ถูกต้อง")
    if not stationId.strip() or len(stationId) > 200:
        raise HTTPException(status_code=400, detail="stationId รูปแบบไม่ถูกต้อง")
    if modelId not in MODEL_IDS:
        raise HTTPException(status_code=400, detail="ไม่รู้จักโมเดลที่เลือก")
    data = await audio.read(MAX_AUDIO_BYTES + 1)
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="ไฟล์เสียงมีขนาดเกิน 20 MiB")
    if not data:
        raise HTTPException(status_code=400, detail="ไฟล์เสียงว่าง")
    try:
        bundle = app.state.bundles[modelId]
        segments = infer(data, bundle)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        # Keep internal paths and traceback out of the HTTP response.
        print(f"Inference failed for {requestId}: {type(exc).__name__}: {exc}")
        raise HTTPException(status_code=500, detail="บริการวิเคราะห์เสียงเกิดข้อผิดพลาด") from exc

    # Clip-level presence scores use max pooling across windows, matching 05's
    # detected-class union. These scores/thresholds remain provisional.
    classes = bundle["classes"]
    scores_by_class = {
        class_id: max(
            score["score"]
            for segment in segments
            for score in segment["scores"]
            if score["classId"] == class_id
        )
        for class_id in classes
    }
    decision_threshold = float(bundle["config"].get("decision_threshold", 0.5))
    if not 0.0 <= decision_threshold <= 1.0:
        decision_threshold = 0.5
    winner_index = max(range(len(classes)), key=lambda index: scores_by_class[classes[index]])
    return JSONResponse(
        {
            "requestId": requestId,
            "modelVersion": MODEL_VERSIONS[modelId],
            "modelId": modelId,
            "modelLabel": MODEL_LABELS[modelId],
            "label": classes[winner_index],
            "decisionThreshold": decision_threshold,
            "scores": [
                {
                    "classId": class_id,
                    "label": CLASS_LABELS.get(class_id, class_id),
                    "score": float(scores_by_class[class_id]),
                }
                for index, class_id in enumerate(classes)
            ],
            "segments": segments,
        }
    )
