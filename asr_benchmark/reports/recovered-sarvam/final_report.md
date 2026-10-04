# ASR evaluation report

Cases: 20

## Overall results

| Provider | Cases | Successful | Mean WER | Mean CER | Exact match | Median latency (s) |
|---|---:|---:|---:|---:|---:|---:|
| sarvam:saaras:v4 | 20 | 20 | 0.178268 | 0.14088 | 0.45 | 0.428559 |

## By language

| Provider | language | successful | mean_wer | mean_cer | exact_match_rate |
|---|---|---|---|---|---|
| sarvam:saaras:v4 | en-IN | 8 | 0.09127 | 0.025552 | 0.5 |
| sarvam:saaras:v4 | hi-IN | 6 | 0.242615 | 0.22772 | 0.333333 |
| sarvam:saaras:v4 | pa-IN | 6 | 0.229919 | 0.207809 | 0.5 |

## By scenario

| Provider | scenario | cases | successful | mean_wer | mean_cer | exact_match_rate | mean_latency_seconds |
|---|---|---|---|---|---|---|---|
| sarvam:saaras:v4 | accent | 1 | 1 | 0.222222 | 0.116279 | 0.0 | 0.42042 |
| sarvam:saaras:v4 | clean | 4 | 4 | 0.0 | 0.0 | 1.0 | 0.389404 |
| sarvam:saaras:v4 | mixed | 2 | 2 | 0.683334 | 0.586207 | 0.0 | 0.381894 |
| sarvam:saaras:v4 | names | 4 | 4 | 0.086806 | 0.056126 | 0.25 | 0.408104 |
| sarvam:saaras:v4 | noise | 3 | 3 | 0.043418 | 0.043333 | 0.333333 | 0.456018 |
| sarvam:saaras:v4 | phone | 3 | 3 | 0.499666 | 0.391465 | 0.0 | 0.476502 |
| sarvam:saaras:v4 | purpose | 3 | 3 | 0.0 | 0.0 | 1.0 | 0.40996 |

## By difficulty

| Provider | difficulty | cases | successful | mean_wer | mean_cer | exact_match_rate | mean_latency_seconds |
|---|---|---|---|---|---|---|---|
| sarvam:saaras:v4 | easy | 4 | 4 | 0.0 | 0.0 | 1.0 | 0.389404 |
| sarvam:saaras:v4 | hard | 9 | 9 | 0.357571 | 0.288121 | 0.111111 | 0.442419 |
| sarvam:saaras:v4 | medium | 7 | 7 | 0.049603 | 0.032072 | 0.571429 | 0.408899 |

Graphs are stored alongside this report as PNG files.
