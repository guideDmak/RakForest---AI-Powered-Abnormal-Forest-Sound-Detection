# คู่มืออธิบายโค้ดใน Notebooks ของ RakForest

เอกสารนี้อธิบายโน้ตบุ๊ก Python ในโฟลเดอร์ `notebooks/` โดยเรียงตามหน้าที่ของโค้ด ใช้เป็นโน้ตเตรียมอธิบายให้อาจารย์ฟังได้ เน้นว่าแต่ละช่วงทำอะไร ตัวแปรหลักหมายถึงอะไร ไลบรารีช่วยตรงไหน และข้อมูล/ไฟล์ใดถูกอ่านหรือสร้างขึ้น

> **ข้อควรทราบ:** เซลล์ใน Jupyter ใช้ตัวแปรร่วมกันตามลำดับที่รัน ถ้าข้ามเซลล์ ตัวแปรที่เซลล์ถัดไปต้องใช้จะยังไม่มี ควรรันจากบนลงล่าง และถ้าแก้ manifest หรือ config ให้รันเซลล์ที่เกี่ยวข้องใหม่ทั้งหมดก่อนเชื่อผลลัพธ์

## ภาพรวมกระบวนการ

```text
01 ดาวน์โหลด/จัดเตรียมข้อมูลดิบ
   ↓
02 ตรวจข้อมูล, map ป้าย, ตรวจคุณภาพ, แบ่ง train/val/test, สร้างคลิป 4 วินาทีและ manifest
   ├── 03 ฝึก CNN แบบ Multi-label ── 04 ประเมินบน Test ที่กันไว้
   ├── 09 ฝึก CRNN แบบ Multi-label ── 10 ประเมินบน Test ที่กันไว้
   ├── 07 เปรียบเทียบสามโมเดลบน Validation และฝึก Single-label baseline ใหม่
   │     └── 08 รายงาน Validation ของ Single-label
   ├── 05 ทดลองกับไฟล์เสียงใหม่และเปรียบเทียบโมเดล
   └── 06 ให้คนฟังตรวจคลิปเสียง fire ที่น่าสงสัย (งานตรวจทานแยกจากการฝึก)
```

ลำดับแนะนำเมื่อเริ่มจากข้อมูลดิบคือ `01 → 02 → 03 → 09 → 07 → 08 → 04 → 10 → 05` ส่วน `06` ใช้เมื่อมีชุดเสียงสำหรับตรวจทานให้คนฟังโดยเฉพาะ เช่น Zenodo Fire; โน้ตบุ๊กนี้ไม่ได้เอาผลตรวจไปเขียนทับข้อมูลดิบหรือฝึกโมเดลให้อัตโนมัติ

ถ้ามีข้อมูลและ checkpoint ปัจจุบันอยู่แล้ว ไม่จำเป็นต้องดาวน์โหลดหรือฝึกใหม่เพื่อเปิดดูผลเดิม แต่ถ้าเปลี่ยนข้อมูล/ป้ายใน `02` ต้องฝึกโมเดลใหม่ก่อนประเมิน เพราะ checkpoint เก็บลายเซ็นของ manifest ไว้ตรวจว่าตรงกับข้อมูลหรือไม่

## คำศัพท์ที่ใช้ในโน้ตบุ๊ก

- **Recording / source file:** ไฟล์เสียงต้นฉบับหนึ่งไฟล์จากชุดข้อมูล
- **Clip / segment:** ช่วงเสียงย่อยที่ตัดจาก recording; ตอนเตรียมข้อมูลแบ่งเป็นช่วงต่อเนื่องช่วงละ 4 วินาที
- **Manifest:** ตารางบอกว่าไฟล์เสียงแต่ละคลิปอยู่ที่ไหน มาจากชุดใด มีป้ายอะไร อยู่กลุ่ม recording ใด และเป็น train, validation หรือ test
- **`target_label`:** ป้ายหลักหนึ่งคลาส ใช้กับ Baseline แบบ Single-label และช่วยแบ่งกลุ่มแบบ stratified
- **`target_labels`:** รายการป้ายทั้งหมดของคลิป ใช้กับโมเดล Multi-label; หนึ่งคลิปอาจมีหลายป้ายตาม metadata
- **Split:** `train` ใช้ปรับน้ำหนักโมเดล, `val` ใช้เลือก epoch/ตรวจแนวโน้ม, `test` กันไว้รายงานผลครั้งสุดท้าย
- **Group leakage:** เสียงจาก recording เดียวกันหรือไฟล์ซ้ำไปอยู่หลาย split ทำให้ผลทดสอบดูดีเกินจริง การแบ่งด้วย `group_key` ช่วยกันปัญหานี้
- **Single-label / Softmax:** เลือกคลาสที่น่าจะใช่ที่สุดเพียงคลาสเดียว; คะแนนทุกคลาสรวมกันเป็น 1
- **Multi-label / Sigmoid:** แต่ละคลาสมีคะแนนอิสระ คลิปเดียวติดได้หลายคลาส; ใช้ threshold เช่น 0.5 ตัดสินว่าคลาสใดผ่านเกณฑ์
- **Log-Mel spectrogram:** แปลงเสียงเป็นภาพพลังงานตามเวลาและย่านความถี่ แล้วป้อนภาพนี้ให้โมเดล
- **Checkpoint:** ไฟล์บันทึกน้ำหนักโมเดลและข้อมูลประกอบที่จำเป็นสำหรับโหลดกลับ เช่น class order และ preprocessing config

## ไลบรารีหลักที่ใช้

| ไลบรารี / โมดูล | ใช้ทำอะไรในโปรเจกต์ |
| --- | --- |
| `pathlib.Path` | สร้างและจัดการ path ของโฟลเดอร์/ไฟล์ โดยใช้ `/` ต่อ path ได้ เช่น `PROJECT_ROOT / 'data' / 'raw'` |
| `os`, `sys` | อ่าน environment variables, ระบุ Python interpreter ปัจจุบัน และส่ง interpreter นั้นไปเรียก `pip` หรือคำสั่งย่อย |
| `importlib.util` | เช็กว่า package ติดตั้งอยู่หรือยัง ก่อนสั่งติดตั้งเฉพาะตัวที่ขาด |
| `subprocess` | เรียกคำสั่งระบบจาก Python เช่น `python -m pip install ...` หรือ Kaggle CLI |
| `python-dotenv` (`load_dotenv`) | อ่าน credentials จาก `.env` โดยไม่เขียน token ลงในโค้ดโน้ตบุ๊ก |
| `requests` | ดาวน์โหลดไฟล์จาก URL/เรียก API; ใช้ streaming และ HTTP Range เพื่อ resume ไฟล์ใหญ่ที่ดาวน์โหลดค้าง |
| `zipfile`, `tarfile`, `shutil` | แตกไฟล์ archive, เลือกสมาชิกจาก tar และจัดการไฟล์ |
| `datasets` ของ Hugging Face | `load_dataset`, `save_to_disk`, `load_from_disk` สำหรับโหลด/บันทึก RFCx ในรูปแบบ Arrow dataset |
| `gdown`, `google-auth`, `googleapiclient` | ดาวน์โหลดโฟลเดอร์ Google Drive; ถ้าลิงก์สาธารณะไม่ได้จึงลอง Google Application Default Credentials |
| `kaggle` | ดาวน์โหลด FSC22 และ Vehicle Sounds ผ่าน Kaggle API; ต้องมี credentials ใน `.env` |
| `h5py` | อ่าน Fire Event Detection ที่เก็บ waveform segments และ labels ใน HDF5 |
| `hashlib` | คำนวณ SHA-256/MD5 ตรวจไฟล์ซ้ำหรือความถูกต้อง; SHA-1 ใช้ทำ cache key/รหัสสั้น ไม่ใช่รหัสผ่าน |
| `json` | อ่าน/เขียนข้อมูล config, marker และ multi-label list ที่เก็บเป็น JSON ใน manifest |
| `datetime`, `timezone` | บันทึกเวลาสร้าง manifest สรุปการดาวน์โหลดเป็น UTC |
| `collections.Counter`, `defaultdict` | นับจำนวน/จัดกลุ่มรายการในงานตรวจข้อมูลและการดาวน์โหลด |
| `numpy` (`np`) | คำนวณอาร์เรย์เสียง, RMS, padding, masks, multi-hot labels และจัด batch features |
| `pandas` (`pd`) | อ่าน/จัดการตารางข้อมูล, manifest, groupby/crosstab และส่งออก CSV/Parquet |
| `soundfile` (`sf`) | อ่าน metadata/เสียง WAV และเขียนคลิปมาตรฐานเป็น PCM WAV; อ่าน header ได้ด้วย `sf.info` |
| `librosa` | โหลด/แปลงเสียง, resampling, mel spectrogram, dB, RMS, spectral centroid, zero-crossing rate |
| `matplotlib.pyplot` (`plt`) | สร้างกราฟ training curves, waveform, confusion/error charts และ spectrogram |
| `seaborn` (`sns`) | heatmap และ boxplot สำหรับ EDA/รายงาน metrics |
| `tqdm` / `tqdm.auto` | แสดง progress bar ระหว่างดาวน์โหลด/สแกนไฟล์/ฝึก/ทำนาย |
| `scikit-learn` | metrics เช่น F1, precision, recall, accuracy, Hamming loss; StandardScaler/NearestNeighbors และ StratifiedGroupKFold ใน EDA |
| `torch` / `torch.nn` | สร้างและฝึก CNN/CRNN, tensors, loss, optimizer, device และบันทึก checkpoint |
| `torch.utils.data.Dataset`, `DataLoader` | นิยามวิธีโหลดตัวอย่างทีละรายการ และจัดเป็น batch สำหรับ train/evaluate |
| `IPython.display` (`Audio`, `display`, `Markdown`) | แสดงเสียงให้มนุษย์ฟัง ตาราง/กราฟ และหัวข้อในผลลัพธ์ Jupyter |
| `ipywidgets` | ทำช่องอัปโหลดไฟล์เสียงใน `05_infer_new_audio.ipynb` |

### คำสั่งและรูปแบบ Python ที่เห็นบ่อย

- `import X as y` โหลดไลบรารีแล้วตั้งชื่อย่อ เช่น `numpy as np`
- `from X import Y` โหลดเฉพาะส่วนที่ต้องใช้ เช่น `from pathlib import Path`
- `pip install` ติดตั้ง package; โน้ตบุ๊กส่วนใหญ่เช็กก่อนแล้วติดตั้งเฉพาะ package ที่ขาดเพื่อไม่อัปเดต environment โดยไม่จำเป็น
- `Path.cwd()` อ่านโฟลเดอร์ที่ kernel เปิดอยู่; โค้ดปรับ `PROJECT_ROOT` ให้ใช้ได้ทั้งเปิดจาก root และจาก `notebooks/`
- `mkdir(parents=True, exist_ok=True)` สร้างโฟลเดอร์รวมโฟลเดอร์แม่ และไม่ error ถ้ามีอยู่แล้ว
- `if ...:` ทำงานเฉพาะเมื่อเงื่อนไขเป็นจริง; `else` คือกรณีอื่น; `elif` คือเงื่อนไขเพิ่มเติม
- `for x in ...:` วนทำงานทีละรายการ; `enumerate(...)` เพิ่มเลขลำดับ; `tqdm(...)` ครอบ iterator เพื่อเห็นความคืบหน้า
- `def name(...):` ประกาศฟังก์ชัน; `return` ส่งผลลัพธ์กลับ
- `class Name(...)` ประกาศ class; `self` หมายถึง object ปัจจุบัน; ใน `Dataset` จะมี `__len__` บอกจำนวนตัวอย่างและ `__getitem__` โหลดตัวอย่างหนึ่งรายการ
- `try/except` จับข้อผิดพลาดที่คาดได้ เพื่อรายงาน/ข้ามไฟล์เสีย; `raise` หยุดทำงานพร้อม error ที่อธิบายสาเหตุ
- `with ... as ...:` เปิด resource เช่นไฟล์หรือ HTTP response แล้วปิดให้อัตโนมัติเมื่อจบ block
- `f'...{value}...'` สร้างข้อความโดยแทรกค่าตัวแปร; `:,.0f`/`,:` ใช้จัดตัวเลขให้อ่านง่าย
- `df['column']` เลือกคอลัมน์; `.loc[...]` เลือกแถว/คอลัมน์ตามเงื่อนไข; `.groupby(...)` จัดกลุ่ม; `.agg(...)` สรุป; `.merge(...)` รวมตาราง
- `.to_csv(...)`, `.to_parquet(...)`, `.write_text(...)` บันทึกผลเป็น CSV, Parquet, หรือข้อความ/JSON
- `torch.no_grad()` ปิดการคำนวณ gradient ตอน evaluate/inference เพื่อประหยัดหน่วยความจำและเวลา
- `model.train()` เปิดโหมดฝึก; `model.eval()` เปิดโหมดประเมิน/ทำนาย
- `torch.sigmoid(logits)` แปลงคะแนนดิบเป็นคะแนน 0–1 อิสระต่อคลาส; `torch.softmax(logits, dim=1)` ทำให้คะแนนทั้งคลาสรวมเป็น 1

## อธิบายทีละ Notebook

### 01 — `01_download_datasets.ipynb`: ดาวน์โหลดและเตรียมข้อมูลดิบ

**หน้าที่:** ดาวน์โหลดชุดเสียง/metadata ลง `data/raw/` โดยพยายามข้ามข้อมูลที่มีครบแล้ว และสร้าง manifests บอกแหล่งข้อมูล/จำนวน/ขนาดไฟล์ ไม่ทำ label mapping หรือฝึกโมเดล

**ไลบรารีที่เด่น:** `requests`, `zipfile`, `tarfile`, `datasets`, `kaggle`, `gdown`, `google-auth`, `googleapiclient`, `h5py`, `soundfile`, `hashlib`, `concurrent.futures`, `subprocess`, `python-dotenv`

**ตัวแปรและฟังก์ชันสำคัญ:**

- `PROJECT_ROOT`: โฟลเดอร์หลักของโปรเจกต์; ถ้าเปิด notebook จาก `notebooks/` จะเลื่อนขึ้นหนึ่งระดับ
- `RAW_DIR`: ตำแหน่ง `data/raw/` สำหรับไฟล์ต้นฉบับและ archive
- `AUDIO_EXTENSIONS`: whitelist นามสกุลเสียงที่ใช้ตัดสินว่าโฟลเดอร์มีเสียงแล้ว
- `has_audio(folder)`: ค้นหาไฟล์เสียงในโฟลเดอร์ย่อย เพื่อตัดสินใจว่าจะข้ามดาวน์โหลด/แตกไฟล์หรือไม่
- `download_file(url, destination)`: ดาวน์โหลดแบบ streaming เป็นชิ้นใหญ่ลง `.part`; ถ้ามีไฟล์ `.part` จะลอง resume ด้วย HTTP Range; ดาวน์โหลดจบแล้วจึงเปลี่ยนชื่อเป็นไฟล์จริง
- `extract_zip(archive, destination)`: แตก ZIP; ถ้าเจอไฟล์เสียงในปลายทางแล้วจะข้าม
- `USE_FSD50K=False`, `DOWNLOAD_ZENODO_FIRE_FOR_REVIEW=False`: ปิดการดาวน์โหลด FSD50K และ Zenodo Fire ไว้ตามค่าเริ่มต้น; Zenodo Fire ตั้งใจเป็น review-only ไม่ใช่ชุด train ปัจจุบัน
- `DRIVE_FOLDER_ID`, `DOWNLOAD_MARKER`: ใช้ตรวจว่าโฟลเดอร์ Google Drive เดิมดาวน์โหลดครบแล้วหรือยัง
- `GUNSHOT_EXTRA_DIRS`: แยกปลายทางเสียงปืนแต่ละแหล่ง; `checksum_file` ตรวจ SHA; C3GD ตรวจเหตุการณ์เดียวกันที่บันทึกจากหลายไมค์
- `FIRE_EVENT_HDF5`: HDF5 มีทั้ง fire/non-fire; โค้ดเลือกเฉพาะ `class_labels == 1`, รวม segment ที่เป็น recording เดียวกัน แล้วเขียน WAV
- `HUMAN_AUDIO_DIRS`: ตำแหน่ง VocalSound, Nonspeech7k, Common Voice; Common Voice เป็น optional และต้องมี access/API key ตามเงื่อนไขแหล่งข้อมูล

**แหล่งข้อมูลที่โค้ดจัดการ:** ESC-50, Footstep-set, DataSEC v2, RFCx FrugalAI (Hugging Face), FSC22 และ Vehicle Sounds (Kaggle), Google Drive Fire Sounds, Fire Event Detection (เลือกเฉพาะ fire), ชุดเสียงปืน C3GD/Tropical Forest/Zenodo/M16 และชุดเสียงคน VocalSound/Nonspeech7k/Common Voice Thai 27.0. FreeSound Fire อาจอยู่ใน inventory ได้ถ้ามีการเตรียมไว้ใน `data/raw/`. FSD50K และ Zenodo Fire ไม่เปิดโดยปริยาย

**Credentials:** อ่านจาก `.env` เช่น Kaggle/Hugging Face/Common Voice; cell ไม่ควรพิมพ์ token/key ออกหน้าจอ ให้เก็บเป็น environment variable

**ผลลัพธ์:** โฟลเดอร์และ archive ใน `data/raw/`, metadata manifests เช่น `data/manifests/download_manifest.json`, `gunshot_extra_sources.json`, `human_audio_sources.json`, และ `gunshot_extra_dedup_manifest.csv`

**พูดให้อาจารย์ฟัง:** “เล่มนี้รวบรวมเสียงจากหลายแหล่งและตรวจการดาวน์โหลดให้ทำซ้ำได้ มีการ resume ไฟล์ใหญ่ ตรวจ checksum และแยกชุดที่ยังไม่ผ่าน review ออกจากชุด train โดยยังเก็บไฟล์ต้นฉบับไว้”

### 02 — `02_eda_cleaning.ipynb`: สำรวจ ตรวจ label และทำคลิปมาตรฐาน

**หน้าที่:** ตรวจว่า raw data พร้อม, สร้างบัญชีเสียง, อ่าน metadata, map ป้ายให้เป็นคลาส 10 คลาส, คัดธงไฟล์เสีย/ซ้ำ/เงียบ, แบ่งข้อมูลตามกลุ่ม recording, preprocess แล้วสร้าง manifest สำหรับการฝึก

**คลาสมาตรฐาน (`TARGET_CLASSES`):** `fire`, `chainsaw`, `vehicle`, `human_activity`, `threat_tactical`, `gunshot`, `weather`, `natural_ambient`, `silence`, `other`

**ไลบรารีเด่น:** `pandas`/`numpy` สำหรับ inventory และ labels; `soundfile`/`librosa` สำหรับอ่าน/วิเคราะห์เสียง; `matplotlib`/`seaborn` สำหรับกราฟ; `StratifiedGroupKFold` สำหรับ split; `StandardScaler`/`NearestNeighbors` สำหรับเสนอคู่เสียงที่มีคุณสมบัติใกล้กัน; `IPython.display.Audio` สำหรับฟัง; `datasets` สำหรับ export RFCx ที่เก็บเป็น Hugging Face format

**ตัวแปรสำคัญ:**

- `DATASET_DIRS`: map ชื่อ dataset ไปยังโฟลเดอร์ raw ที่จะ scan; `PAUSED_DATASETS={'fsd50k_v1'}` กัน FSD50K ออกจาก pipeline
- `OPTIONAL_DATASETS={'common_voice_thai_27'}`: preflight อนุญาตให้ชุด optional ยังไม่มีได้; ชุด active ที่จำเป็นอื่นต้องมีเสียง เว้นแต่ตั้ง `ALLOW_PARTIAL_DATASETS=True` เพื่อทดสอบบางชุด
- `all_partial_downloads`, `partial_downloads`, `stale_partial_downloads`: ค้นหาไฟล์ `.part`/ไฟล์ดาวน์โหลดไม่ครบ; partial ที่เพิ่งเปลี่ยนแปลงจะหยุดงานเพื่อไม่อ่านข้อมูลระหว่างดาวน์โหลด; partial เก่าแสดงเตือนและไม่ถูกอ่านเป็นเสียง
- `files_df`: ตารางบัญชีไฟล์ raw โดยมี dataset, path, relative path และ source label
- `metadata_label_lookup(...)`: หาไฟล์ CSV/TSV/XLSX/JSON ที่มี metadata แล้วจับชื่อเสียงกับ label; ถ้าไม่มี metadata ใช้ชื่อโฟลเดอร์เป็น label เบื้องต้น
- `LABEL_OVERRIDES`, `map_one_source_label`, `map_labels`: แปลงชื่อ label ต้นทางหลายรูปแบบเป็นคลาสมาตรฐาน; `map_labels` เก็บหลายคลาสใน `target_labels`; `map_label` เก็บคลาสแรกเป็น `target_label`
- `all_df`: inventory ที่รวม features ทางเทคนิค เช่น duration, sample rate, channels, RMS, peak, clipping ratio, spectral centroid, ZCR, read error, SHA-256 และ cleaning flags
- `SILENCE_RMS_THRESHOLD=1e-4`, `CLIPPING_RATIO_FLAG=0.001`: เกณฑ์ **ธงให้ตรวจ**; clipping และ statistical outlier ไม่ถูกลบอัตโนมัติ
- `MANUAL_EXCLUDE_FILES`: รายการ path ที่คนฟังยืนยันเองว่าไม่ควรใช้; ค่าเริ่มต้นว่าง ไม่มีการลบไฟล์จาก disk
- `group_key`: ใช้ SHA-256 ของเสียงเพื่อจัดเสียงซ้ำให้อยู่กลุ่มเดียวกัน; ถ้าหา hash ไม่ได้ใช้ file path
- `StratifiedGroupKFold`: สร้าง fold โดยให้ group อยู่ fold เดียว; stratify จาก `target_label` หลัก จึงไม่ใช่การทำ multi-label stratification เต็มรูปแบบ
- `TARGET_SR=16000`, `TARGET_DURATION=4.0`, `TARGET_SAMPLES=64000`: ตั้งรูปแบบเสียงที่ส่งให้โมเดล
- `PREPROCESS_CONFIG`: เก็บกติกา preprocessing เช่น mono, ลบ DC offset, 16 kHz, 4 วินาที, pad คลิปท้าย, ไม่ normalize amplitude และ schema ของ labels
- `prepare_clips(path)`: โหลด mono, ลบค่าเฉลี่ย waveform (DC offset), resample และตัดเป็นคลิป 4 วินาที; ช่วงสุดท้ายที่สั้นจะเติมศูนย์
- `processed_manifest.parquet`: ตารางเชื่อมคลิปที่เขียนใน `data/processed/clips/` กับ source recording, labels, group และ split

**การตีความ cleaning:** `clean_reason` ใช้แยก unreadable, near-silent, exact duplicate, duplicate ที่ labels ขัดกัน และ keep. Outlier จาก IQR, clipping และคู่เสียงใกล้กันเป็นเพียงรายการตรวจ ไม่ใช่คำสั่งลบอัตโนมัติ; ผู้ใช้ควรฟังเสียงก่อนกรอก exclusion list

**ไฟล์ผลลัพธ์หลัก:**

- `reports/audio_inventory.parquet`, `cleaning_audit.parquet`, `label_mapping_audit.csv`
- `reports/near_duplicate_candidates.csv`, `manual_exclusions.csv`, `excluded_files_review.csv`
- `data/processed/recording_split_manifest.parquet`
- `data/processed/clips/*.wav`, `processed_manifest.parquet`, `preprocess_config.json`
- `reports/eda_cleaning_summary.json`, `dataset_overview.csv`, `post_cleaning_feature_audit.csv`

**พูดให้อาจารย์ฟัง:** “เรา map label ให้เป็นศัพท์กลาง ตรวจความอ่านได้/ความซ้ำโดยไม่ลบอัตโนมัติ แล้วแบ่ง train/validation/test ที่ระดับ recording ก่อนตัดคลิป เพื่อไม่ให้เสียงจากต้นฉบับเดียวกันไปอยู่ทั้ง train และ test”

### 03 — `03_train_model.ipynb`: ฝึก CNN แบบ Multi-label

**หน้าที่:** โหลด `processed_manifest.parquet`, ตรวจ schema/labels/split/ไฟล์เสียง, เตรียม log-Mel, สร้าง CNN และฝึกด้วย target หลายคลาส

**ตัวแปร/config หลัก:** `SAMPLE_RATE=16000`, `DURATION_SECONDS=4`, `N_MELS=64`, `N_FFT=1024`, `HOP_LENGTH=320`, `BATCH_SIZE=32`, `EPOCHS=20`, `LEARNING_RATE=1e-3`, `WEIGHT_DECAY=1e-4`, `PATIENCE=4`, `CLASS_NAMES` 10 คลาส, `BASE_THRESHOLD=0.5`, `MIX_PROBABILITY=0.05`, `MIX_SNR_DB_RANGE=(-6, 3)`, `DEVICE` เลือก CUDA/MPS/CPU

- `MANIFEST_PATH`, `MODEL_DIR`, `REPORT_DIR`: ชี้ manifest, checkpoint และ report
- `parse_labels`: อ่าน `target_labels` จาก JSON list แล้วตรวจว่าป้ายไม่ว่าง/ไม่มีแท็กที่ไม่รู้จัก
- `missing_audio`: ตรวจ path เสียงจริงพร้อม progress bar; ตัวเลขใน bar คือจำนวนที่ตรวจแล้วจาก manifest ทั้งหมด
- `MANIFEST_SIGNATURE`: hash ของคอลัมน์ไฟล์/ป้าย/split/group/dataset เพื่อกันใช้ checkpoint กับ manifest คนละรุ่น
- `label_matrix`: ตาราง 0/1 ขนาดจำนวนคลิป × จำนวนคลาส (multi-hot); `support` นับจำนวน positive ต่อ split
- `load_wave`: ทำ mono/resample/ลบ DC offset/pad หรือ crop ให้ครบ 4 วินาที
- `to_logmel`: สร้าง 64-band mel spectrogram, แปลงเป็น dB และ standardize ต่อคลิป
- `feature_cache_path`: สร้าง path cache `.npy` จาก file path/size/mtime และ feature config เพื่อไม่คำนวณซ้ำ
- `ForestAudioDataset`: โหลด feature-target หนึ่งตัวอย่าง; ระหว่าง train มีโอกาส 5% ผสม waveform จาก train clip อีกคลาส แล้วรวม target; `silence`/`other` ไม่ถูกนำไปเป็น synthetic mix source
- `spec_augment`: สุ่มปิดแถบความถี่/ช่วงเวลาใน spectrogram เพื่อ augmentation
- `ConvBlock`: Conv2D + BatchNorm + ReLU + MaxPool; `AudioCNN` เรียง 4 blocks (1→16→32→64→128 channels), global pooling, dropout และ linear head 10 outputs
- `BCEWithLogitsLoss(pos_weight=...)`: loss สำหรับ multi-label; `pos_weight` ช่วยชดเชยคลาสที่ positive น้อย โดย cap น้ำหนักไม่ให้เกิน 10
- `AdamW`, `ReduceLROnPlateau`, gradient clipping และ early stopping: ปรับน้ำหนัก, ลด learning rate เมื่อ validation ไม่ดีขึ้น และหยุดเมื่อไม่ดีขึ้นต่อเนื่อง
- `run_epoch`: วน batch, คำนวณ logits/loss/gradient ตอน train; ตอน validation ใช้ `no_grad`; แปลง logits เป็น sigmoid scores และคำนวณ macro/micro F1/exact match
- เลือก checkpoint จาก **Validation macro-F1 ที่ threshold 0.5**; Test ไม่ถูกใช้เลือก epoch

**ผลลัพธ์:** `models/rakforest_audio_cnn_multilabel_best.pt`, `rakforest_audio_cnn_multilabel_config.json`, `reports/multilabel_training_history.csv`, `multilabel_validation_metrics.json` และ training curves/validation report

**จุดอธิบายสำคัญ:** training macro-F1 มาจาก batch ที่อาจมี augmentation; ใช้ดูแนวโน้มการเรียนรู้ ไม่ใช่ evaluation pass อิสระ ตัวชี้วัดที่ใช้เลือก checkpoint คือ validation macro-F1

### 04 — `04_evaluate_model.ipynb`: ประเมิน CNN บน Test

**หน้าที่:** โหลด CNN checkpoint จาก 03 และ manifest เดิม ตรวจ class order/schema/provenance/signature/group leakage แล้ว evaluate เฉพาะแถว `split == 'test'` โดยไม่ฝึกซ้ำ

- `CHECKPOINT_PATH`: `rakforest_audio_cnn_multilabel_best.pt`; `THRESHOLD`: อ่านจาก config (ปัจจุบัน 0.5) และใช้รายงานผล ไม่ค้นหาค่าเหมาะที่สุดจาก Test
- สถาปัตยกรรม `AudioCNN`, `load_wave`, `to_logmel` ต้องตรงกับตอน train เพื่อให้ input shape/scale เหมือนกัน
- `TestAudioDataset`: สร้าง log-Mel และ multi-hot target; cache ทำให้รันซ้ำเร็วขึ้น
- `model.eval()` + `torch.no_grad()`: inference เท่านั้น ไม่มี optimizer/การแก้ weights
- `y_true`, `probabilities`, `y_pred`: labels จริง, คะแนน sigmoid และ labels หลัง threshold
- Metrics: precision/recall/F1 ต่อคลาส, macro-F1, micro-F1, exact match, Hamming loss, Average Precision; นับ TP/FP/FN และสรุปแยก dataset

**ผลลัพธ์:** `multilabel_test_metrics.json`, `multilabel_test_metrics_by_class.csv`, `multilabel_test_metrics_by_dataset.csv`, `multilabel_test_predictions.parquet`; ใช้ Test เพื่อรายงานผลเท่านั้น

### 05 — `05_infer_new_audio.ipynb`: ทดลองไฟล์เสียงใหม่และเปรียบเทียบสามโมเดล

**หน้าที่:** ไม่ฝึกโมเดล; โหลด checkpoint CNN Single-label, CNN Multi-label และ CRNN; รับไฟล์ใหม่จาก widget หรือ `data/incoming_audio/`, แบ่งเป็นช่วง, ทำนาย, บันทึกคะแนนและรายการให้ตรวจ

- `MODEL_PATH`, `SINGLE_MODEL_PATH`, `CRNN_MODEL_PATH`: checkpoint ของแต่ละโมเดล; config ตรวจ sample rate/feature/class order ให้ตรง
- `INPUT_DIR`: ที่เก็บไฟล์ทดลอง; `AUDIO_EXTENSIONS`, `RECURSIVE_INPUT`: กรองชนิดไฟล์และเลือกค้นโฟลเดอร์ย่อยหรือไม่
- `REVIEW_CLASSES`, `REVIEW_THRESHOLD=0.50`: กำหนดว่าคะแนนคลาสใดควรถูกส่งให้คนตรวจ (ค่าเริ่มต้นยัง provisional)
- `ALERT_CLASSES`, `ALERT_THRESHOLD=0.75`: candidate ความสำคัญสูง; ยังไม่ใช่เกณฑ์แจ้งเตือนที่ calibrate แล้ว
- `uploaded_items`, `unique_destination`: รองรับ ipywidgets 7/8 และไม่เขียนทับไฟล์อัปโหลดชื่อซ้ำ
- `load_and_segment`: แปลงเป็น mono/16 kHz และทำช่วง 4 วินาที; ถ้าไฟล์ยาวจะจัด full window สุดท้ายให้ชิดท้ายไฟล์ ไม่สร้าง padded เศษสั้นท้ายคลิป; ไฟล์ที่สั้นกว่า 4 วินาทีจะ pad และถูกติดธง `limited_context`
- Single-label ใช้ `softmax`; Candidate/CRNN ใช้ `sigmoid`; คะแนนทั้งสามแบบไม่ควรเทียบเป็น probability ที่ calibrate ร่วมกัน
- ผลต่อช่วงมี start/end, predicted labels, score แยกคลาส, `review_recommended`, `high_priority_candidate`; สรุประดับไฟล์ด้วยจำนวนช่วงและคะแนนสูงสุด/เฉลี่ย

**ผลลัพธ์:** `reports/inference_predictions.csv`, `inference_file_summary.csv`, `inference_failures.csv`, `inference_three_model_comparison.csv` และรูป `inference_three_model_*.png`

**ข้อควรระวัง:** ค่า threshold เป็นค่าชั่วคราว คะแนนสูงสุดต่อไฟล์หมายถึงพบคะแนนสูงในอย่างน้อยหนึ่งช่วง ไม่ใช่ความน่าจะเป็นความเสี่ยงหรือหลักฐานว่าเหตุเกิดจริง

### 06 — `06_review_suspicious_audio.ipynb`: คนฟังตรวจคลิป review-only

**หน้าที่:** สร้างคิวช่วงละไม่เกิน 4 วินาทีจาก `data/raw/zenodo_fire/`, อ่านผล review เก่ากลับมา, เปิดเสียงช่วงหนึ่งให้คนฟัง และบันทึกการประเมิน ไม่แก้ checkpoint หรือ processed manifest

- `SOURCE_DIR`, `REVIEW_PATH`, `SEGMENT_SECONDS=4`: ที่มาของเสียง, ที่เก็บ annotations, ความยาวช่วง
- `segments`: หนึ่งแถวต่อช่วงพร้อมไฟล์/ลำดับ/start/end/sample rate/channels และ `segment_id` จาก SHA-1 ของ path
- `REVIEW_FIELDS`: `fire_audible`, `speech_audible`, `present_labels`, `segment_quality`, `notes`
- `is_review_complete`: ให้แถวเป็น complete เมื่อ fire/speech ตอบ yes/no, quality ไม่ว่าง/unsure และมี label อย่างน้อยหนึ่งรายการ
- `REVIEW_ROW`: เลือกลำดับในคิวที่ยังไม่ complete เพื่อฟัง
- `FIRE_AUDIBLE`, `SPEECH_AUDIBLE`, `SEGMENT_QUALITY`, `PRESENT_LABELS`, `NOTES`, `REVIEWER`: ช่องที่ผู้ตรวจกรอกตามเสียงจริง; ตรวจค่าก่อนเขียน

**ผลลัพธ์:** `reports/zenodo_fire_segment_review.csv` และ `zenodo_fire_review_queue.csv`; Zenodo Fire เป็น review-only และไม่ได้ถูกรวมเข้า train โดยอัตโนมัติ

### 07 — `07_single_vs_multi_model_comparison.ipynb`: เปรียบเทียบ Validation สามโมเดล

**หน้าที่:** โหลด manifest, สร้าง validation spectrogram สำหรับภาพประกอบ, นิยาม AudioCNN/CRNN ที่ตรงกับ checkpoint และเปรียบเทียบ Single-label CNN, Multi-label Candidate CNN และ CRNN บน Validation ชุดเดียวกัน

- `train_df`, `val_df`: แยกจาก manifest; แม้ test ถูกอ่านเพื่อแสดงจำนวน แต่ไม่ใช้ Test ประเมิน/เลือกโมเดลในเล่มนี้
- `resolve_audio_path`: รองรับ manifest เก็บ absolute path จาก workspace เก่า โดย fallback ไป `data/processed/clips/` ด้วย basename
- `CLASS_NAMES`, `THRESHOLD`, `DEVICE`, `CACHE_DIR`: class order 10 คลาส, threshold 0.5, อุปกรณ์คำนวณ, log-mel cache
- `RakForestDataset`: คืน input พร้อม target สองแบบ: class index สำหรับ Single และ multi-hot vector สำหรับ Sigmoid
- `RETRAIN_SINGLE_BASELINE=True`: ฝึก Single-label baseline ใหม่ เพราะ checkpoint เก่าไม่ตรงกับชุด 10 คลาส; ใช้ train ปรับ weights และ validation macro-F1 เลือก epoch
- Candidate จาก 03 และ CRNN จาก 09 โหลดจาก checkpoint แล้วทำนาย validation; Single ใช้ softmax/argmax, อีกสองตัวใช้ sigmoid/threshold
- รายงาน metrics แยกตาม objective: Single-label accuracy/macro-F1; Multi-label macro/micro-F1/exact match/Hamming loss; ทำ per-class report และ confusion matrices
- Controlled demo เลือกคลิป validation คนละคลาสมาผสม waveform แล้วส่งเสียงเดียวกันให้ทั้งสามโมเดล เป็นตัวอย่างพฤติกรรม ไม่ใช่ผล benchmark ของเสียงผสมจริง

**ผลลัพธ์:** checkpoint/histories ของ Single-label baseline ที่ retrain, รายงาน Validation, confusion/errors, ภาพ `rakforest_validation_log_mel.png`, `rakforest_three_model_validation.png` และภาพ controlled mix

**ข้อจำกัด:** ข้อมูล validation ปัจจุบันมีตัวอย่างที่ติดป้ายหลายคลาสจริงน้อย/ไม่มีตามหมายเหตุใน notebook; คะแนน comparison มาจาก target/objective ต่างกัน จึงไม่ใช่ leaderboard ตรง ๆ และ controlled demo เป็น synthetic

### 08 — `08_singlelabel_validation_report.ipynb`: รายงาน Single-label บน Validation

**หน้าที่:** โหลด checkpoint `rakforest_audio_cnn_singlelabel_retrained_best.pt` จาก 07 แล้ว evaluate บน Validation โดยไม่ฝึกโมเดลใหม่

- ใช้ `target_label` เป็นคำตอบจริงหนึ่งคลาส; ประกอบ log-Mel input ด้วย preprocessing แบบเดียวกับ training
- `ValidationDataset`, `ConvBlock`, `AudioCNN`: จัด batch และสร้าง architecture ให้ตรงกับ checkpoint
- `model.eval()` และ `no_grad`: ทำนายเท่านั้น; metrics มี accuracy, precision/recall/F1 per class, confusion matrix และ classification report
- Error analysis แยก FP/FN และเปิดตัวอย่างเสียงที่ทายผิดเพื่อฟัง

**ผลลัพธ์:** confusion matrix, per-class report และ error-analysis files ใน `reports/`; ทั้งหมดเป็น **Validation** ไม่ใช่ Test

### 09 — `09_train_crnn_sigmoid.ipynb`: ฝึก CRNN + Sigmoid

**หน้าที่:** pipeline ฝึก Multi-label คล้าย 03 แต่แทน classifier ธรรมดาด้วย CRNN ซึ่งเพิ่ม Bidirectional GRU เพื่อใช้ลำดับตามเวลาของ feature frames

**ตัวแปร/config:** ใช้ manifest/10 คลาส/16 kHz/4 วินาที/64 mel bands/`N_FFT=1024`/`HOP_LENGTH=320`, batch 32, AdamW, threshold 0.5, waveform mix 5%, และ split/group validation กติกาเดียวกับ 03

- `ForestAudioDataset`: สร้าง multi-hot targets, waveform mix ทำเฉพาะ train ในหน่วยความจำ ไม่เซฟไฟล์ synthetic; ไม่ผสม `silence`/`other`
- `CRNNConvBlock`: convolutional feature extractor สี่ชั้น (16→32→64→128)
- `CRNN`: ยุบแกน mel ด้วย mean, เปลี่ยนรูป tensor ให้เป็น `[batch, time, features]`, ส่งเข้า bidirectional GRU (`hidden_size=64`) แล้วเฉลี่ย output ตามเวลาและทำนาย 10 classes
- `BCEWithLogitsLoss`, sigmoid, macro-F1 ที่ threshold 0.5: ใช้ train หลาย labels ต่อ clip; เลือก checkpoint ตาม validation macro-F1 และ early stopping; test ไม่ใช้เลือก epoch
- `MANIFEST_SIGNATURE`: ป้องกันประเมิน checkpoint กับข้อมูล/labels/splits คนละชุด

**ผลลัพธ์:** `models/rakforest_crnn_sigmoid_best.pt`, `rakforest_crnn_sigmoid_config.json`, training history, validation metrics/report/error analysis และ training curve

### 10 — `10_evaluate_crnn_sigmoid.ipynb`: ประเมิน CRNN บน Test

**หน้าที่:** โหลด CRNN checkpoint จาก 09 และ manifest ตรวจ schema/class order/signature/dataset/group leakage แล้วทำนายเฉพาะ `split == 'test'`; ไม่มี training loop หรือการผสมเสียง

- `TestAudioDataset`, `load_wave`, `to_logmel`, `CRNN`: ทำ preprocessing/architecture ตรงกับตอนฝึก
- `THRESHOLD`: ใช้ค่าที่บันทึกใน checkpoint (ตอนนี้ 0.5); ไม่ค้น threshold จาก Test
- `all_targets`, `all_probabilities`, `y_true`, `probabilities`, `y_pred`: สะสม label จริง/คะแนน sigmoid/คำตอบหลัง threshold
- Metrics: per-class precision/recall/F1/AP และ TP/FP/FN; macro/micro-F1, exact match, Hamming loss; สรุปตาม dataset
- เปิดเสียงคลิปที่ผิดเพื่อช่วยวิเคราะห์ แต่ไม่ใช้ Test ปรับ threshold หรือเลือกโมเดล

**ผลลัพธ์:** `crnn_sigmoid_test_metrics.json`, metrics per-class/per-dataset CSV และ `crnn_sigmoid_test_predictions.parquet`

## ตัวแปรสำคัญที่เจอซ้ำหลายเล่ม

| ตัวแปร | ความหมาย |
| --- | --- |
| `PROJECT_ROOT` | โฟลเดอร์รากของโปรเจกต์ |
| `RAW_DIR` | โฟลเดอร์เสียงต้นฉบับ `data/raw/` |
| `PROCESSED_DIR` | โฟลเดอร์ข้อมูลที่เตรียมแล้ว `data/processed/` |
| `REPORT_DIR` | ผลตาราง/กราฟ/metrics `reports/` |
| `MODEL_DIR` | checkpoint และ config ของโมเดล `models/` |
| `MANIFEST_PATH` | ตาราง processed clips และ labels ที่ใช้ train/evaluate |
| `CLASS_NAMES` / `class_order` | ลำดับคลาสที่ output neuron แต่ละตำแหน่งแทน; ลำดับต้องเหมือนกันระหว่าง train และ inference |
| `SAMPLE_RATE` | จำนวน sample ต่อวินาที; ใช้ 16,000 Hz |
| `NUM_SAMPLES` | จำนวนตัวอย่างในหนึ่งคลิป; 16,000 × 4 = 64,000 |
| `N_MELS`, `N_FFT`, `HOP_LENGTH` | ค่าคำนวณ mel spectrogram; ต้องตรงกับ checkpoint |
| `DEVICE` | `cuda`, `mps` หรือ `cpu` ที่ PyTorch ใช้ |
| `BATCH_SIZE` | จำนวนคลิปที่ประมวลผลในหนึ่ง batch |
| `split` | ระบุ train/val/test |
| `group_key` | ID ของ recording group ที่ต้องไม่ข้าม split |
| `checkpoint` | น้ำหนัก + schema/class/config/provenance ที่บันทึกจากการฝึก |
| `threshold` | จุดตัดคะแนน sigmoid สำหรับตัดสินคลาสใน Multi-label; ไม่ใช่ค่าความเสี่ยงที่ calibrate แล้ว |

## วิธีอธิบาย Metrics แบบสั้น

- **Precision:** ในรายการที่โมเดลทายว่ามีคลาสนั้น มีถูกกี่ส่วน; ต่ำมักหมายถึง false positives เยอะ
- **Recall:** จากตัวอย่างจริงที่มีคลาสนั้น โมเดลหาเจอกี่ส่วน; ต่ำมักหมายถึง false negatives เยอะ
- **F1:** ค่าเฉลี่ยสมดุลระหว่าง precision กับ recall
- **Macro-F1:** คำนวณ F1 แยกคลาสแล้วเฉลี่ยเท่ากันทุกคลาส เหมาะดูคลาสหายากแต่ไวต่อคลาสที่ข้อมูลน้อย
- **Micro-F1:** รวม TP/FP/FN ทุกคลาสก่อนคำนวณ จึงให้น้ำหนักคลาสที่มีตัวอย่างมากกว่า
- **Exact match:** สัดส่วนคลิปที่ชุด labels ที่โมเดลทายตรงกับชุดจริงทุกคลาส
- **Hamming loss:** สัดส่วนคำตอบรายคลาสที่ผิด ต่ำกว่าดีกว่า
- **Average Precision (AP):** ประเมินการจัดอันดับคะแนนตาม threshold หลายค่า; ถ้าชุด Test ไม่มี positive ของคลาส ค่าอาจเป็น NaN
- **Support:** จำนวนตัวอย่างจริงที่เป็น positive ของคลาสนั้น

## ลำดับเล่าโค้ดให้อาจารย์ฟัง

1. “เริ่มจากรวบรวมเสียงหลายแหล่งไว้ใน `data/raw` และบันทึกที่มา”
2. “ทำ EDA เพื่อดู metadata/คุณภาพเสียงและ map label ให้เหลือคลาสมาตรฐาน 10 คลาส”
3. “แบ่งข้อมูลตาม recording group ก่อนสร้างคลิป เพื่อป้องกันข้อมูลต้นฉบับเดียวกันรั่วไป Test”
4. “ทำคลิป mono 16 kHz ยาว 4 วินาที แล้วแปลงเป็น log-Mel input; manifest เชื่อม input กับ labels/splits”
5. “ฝึก CNN หรือ CRNN ด้วย Multi-label loss; validation เลือก checkpoint ส่วน Test เก็บไว้รายงานผลครั้งเดียว”
6. “ทดสอบเสียงใหม่ได้ใน notebook 05; คะแนนเป็นเครื่องช่วยคัดกรอง ต้องให้คนฟัง/เจ้าหน้าที่ตรวจยืนยัน”
7. “ข้อจำกัดสำคัญคือข้อมูลเสียงจริงที่มีหลายเหตุการณ์พร้อมกันยังมีจำกัด; waveform mix เป็น synthetic augmentation ไม่ได้พิสูจน์ประสิทธิภาพกับเสียงซ้อนจริง”


## ตัวอย่างจากเซลล์โค้ดจริงและคำอธิบายทีละส่วน

เลขเซลล์นับตามลำดับที่เห็นใน Jupyter รวมทั้งเซลล์ Markdown และ Code; โค้ดเต็มอยู่ใน notebook ต้นฉบับที่ระบุ ตัวอย่างด้านล่างคัดเฉพาะช่วงที่ใช้อธิบายแนวคิดหลัก

### 01 — `01_download_datasets.ipynb`

**เซลล์ 5: ตั้งตำแหน่งโปรเจกต์และโฟลเดอร์ข้อมูลดิบ**

```python
PROJECT_ROOT = Path.cwd()
if PROJECT_ROOT.name == 'notebooks':
    PROJECT_ROOT = PROJECT_ROOT.parent
RAW_DIR = PROJECT_ROOT / 'data' / 'raw'
RAW_DIR.mkdir(parents=True, exist_ok=True)
```

`Path.cwd()` อ่านโฟลเดอร์ที่ kernel เปิดอยู่; ถ้าเปิดจาก `notebooks/` จะถอยขึ้นหนึ่งระดับ; `/` บน `Path` ใช้ต่อ path; `mkdir` สร้างโฟลเดอร์และ `exist_ok=True` ทำให้ไม่ error เมื่อมีอยู่แล้ว

**เซลล์ 7: เช็กว่ามีไฟล์เสียงก่อนดาวน์โหลดซ้ำหรือไม่**

```python
def has_audio(folder):
    folder = Path(folder)
    return folder.exists() and any(
        p.is_file() and p.suffix.lower() in AUDIO_EXTENSIONS
        for p in folder.rglob('*')
    )
```

`rglob('*')` ไล่ค้นทุกโฟลเดอร์ย่อย; `suffix.lower()` ตรวจนามสกุลโดยไม่สนตัวพิมพ์; `any` คืนจริงเมื่อพบไฟล์เสียงอย่างน้อยหนึ่งไฟล์ นี่เป็นการเช็กว่ามีเสียง ไม่ได้รับรองว่าดาวน์โหลดครบหรือไฟล์อ่านได้ทุกไฟล์

**เซลล์ 33: คำนวณ SHA-256 ทีละก้อนเพื่อหาไฟล์ซ้ำ**

```python
def file_sha256(path, chunk_size=8 * 1024 * 1024):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(chunk_size), b''):
            h.update(chunk)
    return h.hexdigest()
```

เปิดไฟล์แบบ binary (`rb`), อ่านครั้งละ 8 MiB เพื่อลด RAM, หยุดเมื่ออ่านได้ `b''`; hash ที่ตรงกันบอกว่า byte ของไฟล์เหมือนกันทุกประการ แต่ไม่ครอบคลุมเสียงเดียวกันที่ถูก encode ต่างกัน

### 02 — `02_eda_cleaning.ipynb`

**เซลล์ 17: อ่านคุณสมบัติและคำนวณตัวชี้วัดเสียง**

```python
info = sf.info(path)
y, sr = librosa.load(path, sr=None, mono=True)
row['rms'] = float(np.sqrt(np.mean(y.astype(np.float64) ** 2)))
row['peak'] = float(np.max(np.abs(y)))
row['clipping_ratio'] = float(np.mean(np.abs(y) >= 0.99))
```

`sf.info` อ่าน metadata; `sr=None` คง sample rate เดิมไว้ในขั้นตรวจ; `mono=True` รวมเป็นช่องเดียว; RMS สรุประดับพลังงาน, peak คือค่าสูงสุด และ clipping ratio คือสัดส่วน sample ที่ใกล้ขอบสเกล ตัวเลขเหล่านี้ช่วยชี้ไฟล์ที่ควรตรวจ ไม่ได้ตัดสินลบไฟล์โดยอัตโนมัติ

**เซลล์ 37: แบ่งชุดข้อมูลโดยให้ recording group อยู่ชุดเดียวกัน**

```python
clean_df['group_key'] = clean_df['sha256'].fillna(clean_df['file'])
sgkf = StratifiedGroupKFold(n_splits=n_splits, shuffle=True, random_state=42)
for fold, (_, test_idx) in enumerate(
    sgkf.split(clean_df, clean_df.target_label, clean_df.group_key)
):
    fold_id[test_idx] = fold
```

ใช้ hash เป็น group ID (ไม่มี hash จึงใช้ path); `StratifiedGroupKFold` พยายามรักษาสัดส่วนคลาสและไม่แยก group เดียวกันข้าม fold; `random_state=42` ทำให้สุ่มซ้ำได้ โค้ดถัดไปกำหนด fold ให้เป็น train/val/test

**เซลล์ 39: ทำ waveform เป็น mono 16 kHz และแบ่งคลิป 4 วินาที**

```python
TARGET_SR = 16000
TARGET_DURATION = 4.0
TARGET_SAMPLES = int(TARGET_SR * TARGET_DURATION)
y, sr = librosa.load(path, sr=None, mono=True)
y = y.astype(np.float32)
y -= float(np.mean(y))
if sr != TARGET_SR:
    y = librosa.resample(y, orig_sr=sr, target_sr=TARGET_SR)
```

หนึ่งคลิปมี 64,000 samples; ลบค่าเฉลี่ยเพื่อลด DC offset; resample เมื่อ sample rate ไม่ตรง จากนั้นฟังก์ชันตัดช่วงยาว 64,000 samples และเติมศูนย์เฉพาะช่วงท้ายที่สั้นกว่า 4 วินาที

### 03 — `03_train_model.ipynb`

**เซลล์ 8: โหลด manifest และตรวจความครบก่อนฝึก**

```python
if not MANIFEST_PATH.exists():
    raise FileNotFoundError('รัน 02_eda_cleaning.ipynb ให้เสร็จก่อน')
df = pd.read_parquet(MANIFEST_PATH)
required = {'processed_file', 'target_label', 'target_labels', 'split', 'group_key'}
missing = required - set(df.columns)
if missing:
    raise ValueError(f'Manifest ขาด columns: {sorted(missing)}')
```

อ่าน processed manifest แบบ Parquet; set subtraction หาชื่อคอลัมน์ที่หาย; `raise` หยุดก่อนฝึกพร้อมข้อความแก้ปัญหา เพื่อไม่ฝึกกับข้อมูลผิด schema

**เซลล์ 12: โหลดเสียงและแปลง stereo เป็น mono**

```python
def load_wave(path):
    y, sr = sf.read(path, dtype='float32', always_2d=False)
    if y.ndim == 2:
        y = y.mean(axis=1)
    y = np.asarray(y, dtype=np.float32)
    return y, sr
```

อ่าน waveform เป็น float32; ถ้ามีสองมิติ (เช่น stereo) เฉลี่ยช่องตามแกน 1; คืน waveform และ sample rate ให้ขั้นสร้าง log-Mel

**เซลล์ 16: คำนวณ loss และปรับน้ำหนัก CNN**

```python
logits = model(xb)
loss = criterion(logits, yb)
loss.backward()
optimizer.step()
probs = torch.sigmoid(logits)
```

`logits` คือคะแนนดิบ; `BCEWithLogitsLoss` ใช้กับหลาย label; `backward()` คำนวณ gradient; `step()` ปรับ weights; sigmoid ให้คะแนน 0–1 แยกแต่ละคลาส ไม่บังคับให้รวมกันเป็น 1 ส่วน validation ประเมินโดยไม่ปรับ weights

**ขยายเรื่อง class imbalance ใน Notebook 03**

ในงาน Multi-label คลิปหนึ่งมีคำตอบเป็นเวกเตอร์ เช่น `[fire=0, vehicle=1, weather=1, ...]` แต่ละคลาสจึงมีจำนวน positive/negative ของตัวเอง โค้ดนับจาก label vectors ของ **train split เท่านั้น** แล้วเอาความไม่สมดุลไปปรับ loss:

```python
train_targets = train_ds.label_vectors
positive = train_targets.sum(axis=0)
negative = len(train_targets) - positive
pos_weight = np.clip(negative / np.maximum(positive, 1), 1.0, 10.0)
criterion = nn.BCEWithLogitsLoss(
    pos_weight=torch.tensor(pos_weight, dtype=torch.float32, device=DEVICE)
)
```

อธิบายทีละบรรทัด:

1. `train_ds.label_vectors` คือเมทริกซ์ multi-hot ของคลิปฝึก แถวหนึ่งแทนหนึ่งคลิป คอลัมน์หนึ่งแทนหนึ่งคลาส ค่า 1 คือมี label นั้น ค่า 0 คือไม่มี
2. `sum(axis=0)` รวมตามแถว จึงได้จำนวน positive ของแต่ละคลาส เช่น `[fire, vehicle, weather, ...]`
3. จำนวนคลิปฝึกลบจำนวน positive ได้จำนวน negative ของแต่ละคลาส
4. `negative / positive` ให้สัดส่วนว่าฝั่ง positive มีน้อยแค่ไหนเมื่อเทียบกับ negative; `maximum(positive, 1)` ป้องกันการหารด้วยศูนย์
5. `np.clip(..., 1.0, 10.0)` จำกัดค่าให้อยู่ระหว่าง 1 ถึง 10: น้ำหนักไม่ต่ำกว่า 1 และไม่ปล่อยให้คลาสที่หายากมากสร้างน้ำหนักสูงเกิน 10
6. ส่งเวกเตอร์น้ำหนักเข้า `BCEWithLogitsLoss` โดยแต่ละตำแหน่งตรงกับลำดับ `class_order`; ต้องรักษาลำดับคลาสให้ตรงกับ output ของโมเดล

แนวคิดของ loss ต่อคลาส (เขียนในรูป sigmoid probability `p` เพื่อให้อ่านง่าย) คือ:

```text
loss = -[pos_weight × y × log(p) + (1 - y) × log(1 - p)]
```

เมื่อ label จริง `y=1` ส่วน positive ที่โมเดลทายพลาดจะถูกคูณด้วย `pos_weight`; เมื่อ `y=0` ส่วน negative ไม่ถูกคูณด้วยค่านี้ ดังนั้นคลาสที่พบน้อยจะได้รับแรงเรียนรู้จาก positive มากขึ้น วิธีนี้เรียกว่า **positive class weighting** หรือ **class-weighted binary cross-entropy**; เป็นรูปแบบหนึ่งของ **loss reweighting / cost-sensitive learning**

**ตัวอย่างสมมติ:** ถ้าคลาสหนึ่งมี positive 100 คลิป และ negative 900 คลิป จะได้อัตราส่วน `900/100 = 9` ดังนั้นพลาด positive ของคลาสนั้นจะมีน้ำหนัก 9 ก่อนนำไปรวมกับ loss; ถ้าอัตราส่วนคำนวณได้ 18 ก็ถูก cap เหลือ 10

ข้อจำกัดที่ควรบอกอาจารย์:

- การให้น้ำหนักนี้ไม่ได้สร้างเสียงตัวอย่างเพิ่ม ไม่ได้ลบคลาสที่มาก และไม่ได้เปลี่ยนจำนวนแถวใน train; มันเปลี่ยนผลกระทบของตัวอย่างต่อ loss เท่านั้น
- โค้ดนับ label จากคลิปหลัง preprocessing; ถ้า recording ยาวถูกตัดเป็นหลายคลิป จำนวนคลิปเหล่านั้นมีส่วนต่อ counts ด้วย
- `pos_weight` คำนวณจาก train split ไม่ใช้ validation/test เพื่อป้องกันข้อมูลประเมินรั่วเข้ากระบวนการฝึก
- ค่า cap 10 ช่วยกันน้ำหนักสูงเกินไป แต่ก็หมายความว่าคลาสที่หายากที่สุดอาจไม่ได้รับการชดเชยตามอัตราส่วนเต็ม
- วิธีนี้ไม่ได้ทำให้ข้อมูลสมดุลโดยอัตโนมัติ และไม่ได้รับประกันว่า recall ของทุกคลาสจะดีขึ้น; ต้องตรวจ per-class precision/recall/F1 บน validation และรายงาน test แยกต่างหาก

ประโยคสั้นสำหรับตอบอาจารย์: “ใน CNN Multi-label หนู/ผมใช้ `BCEWithLogitsLoss` พร้อม `pos_weight` ซึ่งคำนวณจากอัตราส่วนจำนวน negative ต่อ positive ของแต่ละคลาสใน train split แล้ว cap ที่ 10 เพื่อเพิ่มโทษเมื่อโมเดลพลาดคลาสที่มีตัวอย่างน้อย วิธีนี้คือ positive class weighting หรือ loss reweighting ไม่ใช่การ oversampling และไม่ได้เพิ่มจำนวนข้อมูลจริง”

### 04 — `04_evaluate_model.ipynb`

**เซลล์ 12: ประเมิน Test โดยไม่ฝึกเพิ่ม**

```python
all_targets, all_probabilities = [], []
model.eval()
with torch.no_grad():
    for xb, yb in tqdm(test_loader, desc='Evaluate held-out test'):
        logits = model(xb.to(DEVICE))
        probs = torch.sigmoid(logits).cpu().numpy()
        all_probabilities.append(probs)
        all_targets.append(yb.numpy())
```

`eval()` ตั้งโหมดประเมิน; `no_grad()` ประหยัดหน่วยความจำ; `tqdm` แสดงความคืบหน้า; `.to(DEVICE)` ย้าย batch ไป CPU/GPU; สะสมคะแนนกับคำตอบจริงเพื่อคำนวณ metrics ภายหลัง ไม่มี `backward()` หรือ optimizer จึงไม่เปลี่ยนน้ำหนักโมเดล

### 05 — `05_infer_new_audio.ipynb`

**เซลล์ 10: สร้างปุ่มอัปโหลดใน Notebook**

```python
import ipywidgets as widgets
from IPython.display import display
uploader = widgets.FileUpload(
    accept='.wav,.mp3,.flac,.ogg,.m4a', multiple=True
)
display(uploader)
```

`accept` ระบุนามสกุลที่เลือกได้; `multiple=True` รับหลายไฟล์; `display` แสดง widget ใน Jupyter เซลล์ถัดไปจัดเก็บไฟล์แล้วแบ่งช่วงเพื่อ inference

**เซลล์ 17: ประมวลผลไฟล์และแยกไฟล์ที่ผิดพลาด**

```python
rows, failures = [], []
for path in tqdm(audio_paths, desc='Predict audio files'):
    try:
        segments, original_sr = load_and_segment(path)
        # โค้ดเต็มทำนายแต่ละช่วงและเพิ่มผลลง rows
    except Exception as e:
        failures.append({'file': str(path), 'error': str(e)})
```

วนทีละไฟล์; `try/except` ทำให้ไฟล์เสียหนึ่งไฟล์ไม่หยุดทั้งชุด; `rows` เก็บผลทำนาย ส่วน `failures` เก็บชื่อ/สาเหตุเพื่อกลับมาตรวจ

### 06 — `06_review_suspicious_audio.ipynb`

**เซลล์ 6: เตรียมช่วงเสียงสำหรับให้คนฟัง**

```python
info = sf.info(path)
for ix, start in enumerate(np.arange(0, info.duration, SEGMENT_SECONDS)):
    end = min(start + SEGMENT_SECONDS, info.duration)
    rows.append({'segment_index': ix, 'start_seconds': start,
                 'end_seconds': end})
```

อ่าน duration จาก metadata; `np.arange` สร้างเวลาเริ่มทุก 4 วินาที; `min` กันเวลาจบเกินความยาวไฟล์; แต่ละช่วงกลายเป็นรายการใน review queue

**เซลล์ 10: ค่าที่ผู้ตรวจกรอกหลังฟัง**

```python
FIRE_AUDIBLE = 'unsure'
SPEECH_AUDIBLE = 'unsure'
SEGMENT_QUALITY = 'unsure'
PRESENT_LABELS = []
```

ผู้ฟังแก้ค่า yes/no/unsure และใส่คลาสที่ได้ยิน; โค้ดตรวจว่าค่าถูกต้องก่อนเซฟ CSV; notebook นี้เป็นงาน annotation ไม่ได้ฝึกโมเดลเอง

### 07 — `07_single_vs_multi_model_comparison.ipynb`

**เซลล์ 4: แยก train/validation และตรวจ group leakage**

```python
train_df = df[df.split.eq('train')].reset_index(drop=True)
val_df = df[df.split.eq('val')].reset_index(drop=True)
leaks = df.groupby('group_key').split.nunique()
if (leaks > 1).any():
    raise ValueError('พบ group_key ที่ข้าม split')
```

`.eq` เลือกแถวตามค่า split; `reset_index` จัดหมายเลขแถวใหม่; `nunique` นับจำนวน split ต่อกลุ่ม; ถ้ามากกว่า 1 จะหยุดเพราะ validation อาจมี recording เดียวกับ train

**เซลล์ 16: รวมผลของโมเดลบน Validation**

```python
comparison = pd.DataFrame([
    {'Model': 'Single-label Baseline', 'Task': 'เลือก 1 คลาส', ...},
    {'Model': 'Multi-label Candidate', 'Task': 'CNN + Sigmoid', ...},
    {'Model': 'CRNN + Sigmoid', 'Task': 'CNN + BiGRU + Sigmoid', ...},
])
display(comparison)
```

สร้างตารางเทียบ validation Macro-F1 และ metrics ที่เหมาะกับแต่ละโจทย์; ต้องอ่าน `Task` ประกอบ เพราะ single-label กับ multi-label ทำนายคนละแบบ และไม่ควรจัดอันดับจากเลขเดียวโดยไม่ดูข้อจำกัดใน notebook

### 08 — `08_singlelabel_validation_report.ipynb`

**เซลล์ 4: กรอง Validation เท่านั้น**

```python
df = pd.read_parquet(MANIFEST_PATH).copy()
val_df = df[df.split.eq('val')].reset_index(drop=True)
if val_df.empty:
    raise ValueError('ไม่พบ Validation rows')
```

ทำสำเนา manifest, เลือกแถว `split == 'val'`; ถ้าไม่มีข้อมูลก็หยุด เล่มนี้โหลด checkpoint และทำรายงาน ไม่ได้ train ใหม่หรือประเมิน Test

**เซลล์ 8: คำนวณรายงานแยกคลาส**

```python
precision, recall, f1, support = precision_recall_fscore_support(
    y_true, y_pred, labels=np.arange(len(CLASS_NAMES)),
    average=None, zero_division=0
)
```

`average=None` คืน metric แยกทุกคลาส; `labels` รักษาลำดับคลาส; `zero_division=0` กำหนดค่าเป็นศูนย์เมื่อหารไม่ได้; `support` คือจำนวนตัวอย่างจริงของคลาส

### 09 — `09_train_crnn_sigmoid.ipynb`

**เซลล์ 14: ให้ CNN สกัด feature แล้ว GRU อ่านตามเวลา**

```python
z = self.features(x)
z = z.mean(dim=2).transpose(1, 2)
sequence, _ = self.gru(z)
pooled = sequence.mean(dim=1)
return self.classifier(self.dropout(pooled))
```

CNN ได้ feature ตาม channel/mel/time; `mean(dim=2)` ยุบแกน mel; `transpose` จัดแกนเป็น batch/time/features ให้ GRU; bidirectional GRU อ่านลำดับเวลาไปและย้อนกลับ; เฉลี่ยผลทุก frame แล้ว classifier สร้างคะแนน 10 คลาส

**เซลล์ 16: เลือกทำ gradient เฉพาะช่วงฝึก**

```python
logits = model(xb)
loss = criterion(logits, yb)
if training:
    loss.backward()
    optimizer.step()
probs = torch.sigmoid(logits)
```

ระหว่าง train จึงคำนวณ gradient และปรับ weights; ระหว่าง validation จะข้ามสองคำสั่งในเงื่อนไข; sigmoid สร้างคะแนนแยกคลาส และ loop รอบนอกเลือก checkpoint จาก validation Macro-F1

### 10 — `10_evaluate_crnn_sigmoid.ipynb`

**เซลล์ 12: ทำนาย Test และใช้ threshold ที่กำหนดไว้**

```python
model.eval()
with torch.no_grad():
    for xb, yb in tqdm(test_loader, desc='Evaluate held-out test'):
        logits = model(xb.to(DEVICE))
        probs = torch.sigmoid(logits).cpu().numpy()
        all_probabilities.append(probs)
        all_targets.append(yb.numpy())
y_pred = (probabilities >= THRESHOLD).astype(np.int32)
```

เป็น inference แบบเดียวกับ 04 แต่ใช้ CRNN; เปรียบคะแนนกับ threshold เพื่อสร้าง label 0/1; ไม่ปรับ threshold จาก Test และไม่ update weights

## คำถามที่อาจารย์ถามต่อ

- **ทำไมต้องมี manifest?** เป็นตารางกลางเชื่อมไฟล์เสียง, label, แหล่งข้อมูล, group และ split ให้ขั้น train/evaluate ใช้รายการเดียวกันและตรวจสอบย้อนกลับได้
- **ทำไมแบ่งตาม group?** ป้องกันช่วงจาก recording ต้นฉบับเดียวกันไปอยู่ทั้ง train และ test จนคะแนนดูดีเกินจริง
- **ทำไมใช้ Sigmoid กับ BCE?** หนึ่งคลิปมีหลายป้ายได้ จึงให้แต่ละคลาสมีคะแนนอิสระและคิด loss แบบคำตอบ yes/no ต่อคลาส
- **Validation กับ Test ต่างกันอย่างไร?** Validation ใช้เลือก epoch/เปรียบเทียบระหว่างพัฒนา; Test กันไว้สรุปผล ไม่ใช้ปรับ threshold หรือเลือกรุ่น
- **checkpoint คืออะไร?** ไฟล์ weights พร้อม class order และ config ที่ใช้โหลดโมเดลกลับด้วย preprocessing เดิม
- **คะแนนสูงยืนยันว่ามีไฟป่าหรือไม่?** ไม่ยืนยัน เป็นคะแนนคัดกรองจากข้อมูลที่ฝึกและ threshold ปัจจุบัน ต้องตรวจเสียง/ประเมินข้อมูลภาคสนามที่ติดป้ายเชื่อถือได้
