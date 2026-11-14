# RakForest local inference API

This service loads the Single-label CNN, Multi-label CNN Candidate, and CRNN checkpoints once when it starts. The upload form selects one through `modelId`.

## Install and run

From the RakForest-ML project root, using the existing virtual environment:

```sh
./.venv/bin/python -m pip install -r api_service/requirements.txt
./.venv/bin/python -m uvicorn api_service.main:app --host 127.0.0.1 --port 8000
```

Keep that terminal open. `GET http://127.0.0.1:8000/health` should report `status: ready`, the ten class IDs including `gunshot`, and all three selectable models. The API binds to loopback for local development and is not intended to be exposed publicly.

## Connect the web app

In `rakforest-web-main/.env.local`, use:

```dotenv
ML_PROVIDER=http
AI_CLASSIFICATION_ENDPOINT=http://127.0.0.1:8000/analyze
AI_CLASSIFICATION_API_KEY=
ML_TIMEOUT_MS=60000
```

Restart the web development server after changing environment values. Start the web in a second terminal from `rakforest-web-main` with `pnpm dev`.

## Inference behavior

- Selects the checkpoint using `modelId` (`cnn_softmax`, `cnn_sigmoid`, or `crnn_sigmoid`) and verifies all three share the current 10-class order and audio preprocessing settings. It rejects legacy checkpoints; rebuild labels in notebook 02 and retrain before use.
- Mirrors notebook 05: mono audio, DC-offset removal, resampling to the checkpoint sample rate, per-window log-mel features, and 4-second windows. The final full window is aligned to the end; files shorter than 4 seconds are padded.
- Returns per-class Softmax scores for the Single-label model, or independent Sigmoid scores for either Multi-label model. For a whole uploaded clip, each class score is the maximum across its windows, so it represents whether that class appeared anywhere. The highest score becomes the contract's required `label`.
- Clip-level max scores and thresholds are provisional; they are not calibrated alert probabilities.
- Accepts files up to 20 MiB, matching the web app. Ten-hour recordings need an asynchronous job workflow and are not supported by the current upload route.

For Apple Silicon or CUDA selection, set `RAKFOREST_DEVICE=auto` (default), `cpu`, `mps`, or `cuda`. Set `RAKFOREST_CHECKPOINT` to override the checkpoint location.
