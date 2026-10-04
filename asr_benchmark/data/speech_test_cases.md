# Speech test cases

Use these cases to evaluate Browser Web Speech, Sarvam, and Whisper.
For every case:

1. Select the language shown.
2. Copy the exact **Reference** text into the reference field.
3. Speak the sentence naturally.
4. Record the same sentence once.
5. Run the selected models on the same recording.
6. Save the result using the case ID.

Do not read the case ID, language, or punctuation aloud. Record each case
separately. Use the same speaker and microphone for a fair comparison.

## English

| ID | Scenario | Difficulty | Reference |
|---|---|---|---|
| en-clean-01 | Clean speech | Easy | Rahul Sharma is here |
| en-clean-02 | Clean speech | Easy | Please register Anita Singh |
| en-name-01 | Names and title | Medium | Rahul Sharma is here to meet Dr. Naveen Aggarwal |
| en-name-02 | Names and department | Medium | Please register Dr. Harpreet Kaur from the CSE department |
| en-phone-01 | Phone number | Hard | Rahul Sharma phone number is 98765 43210 |
| en-purpose-01 | Visit purpose | Medium | Rahul Sharma is here for a project discussion |
| en-noise-01 | Background noise | Hard | Anita Singh is here to meet the department head |
| en-accent-01 | Checkout request | Hard | Please check out Rahul Sharma from the visitor gate |

## Hindi

| ID | Scenario | Difficulty | Reference |
|---|---|---|---|
| hi-clean-01 | Clean speech | Easy | राहुल शर्मा यहां हैं |
| hi-name-01 | Names and title | Medium | राहुल शर्मा डॉ नवीन अग्रवाल से मिलने आए हैं |
| hi-phone-01 | Spoken phone number | Hard | राहुल शर्मा का फोन नंबर नौ आठ सात छह पांच चार तीन दो एक शून्य है |
| hi-purpose-01 | Visit purpose | Medium | राहुल शर्मा परियोजना चर्चा के लिए आए हैं |
| hi-noise-01 | Registration request | Hard | कृपया अनिता सिंह का आगंतुक पंजीकरण करें |
| hi-mixed-01 | Hindi and English mix | Hard | राहुल शर्मा project discussion के लिए आए हैं |

## Punjabi

| ID | Scenario | Difficulty | Reference |
|---|---|---|---|
| pa-clean-01 | Clean speech | Easy | ਰਾਹੁਲ ਸ਼ਰਮਾ ਇੱਥੇ ਹਨ |
| pa-name-01 | Names and title | Medium | ਰਾਹੁਲ ਸ਼ਰਮਾ ਡਾਕਟਰ ਨਵੀਨ ਅਗਰਵਾਲ ਨੂੰ ਮਿਲਣ ਆਏ ਹਨ |
| pa-phone-01 | Spoken phone number | Hard | ਰਾਹੁਲ ਸ਼ਰਮਾ ਦਾ ਫੋਨ ਨੰਬਰ ਨੌਂ ਅੱਠ ਸੱਤ ਛੇ ਪੰਜ ਚਾਰ ਤਿੰਨ ਦੋ ਇੱਕ ਸਿਫ਼ਰ ਹੈ |
| pa-purpose-01 | Visit purpose | Medium | ਰਾਹੁਲ ਸ਼ਰਮਾ ਪ੍ਰੋਜੈਕਟ ਚਰਚਾ ਲਈ ਆਏ ਹਨ |
| pa-noise-01 | Registration request | Hard | ਕਿਰਪਾ ਕਰਕੇ ਅਨੀਤਾ ਸਿੰਘ ਦੀ ਵਿਜ਼ਟਰ ਰਜਿਸਟ੍ਰੇਸ਼ਨ ਕਰੋ |
| pa-mixed-01 | Punjabi and English mix | Hard | ਰਾਹੁਲ ਸ਼ਰਮਾ project discussion ਲਈ ਆਏ ਹਨ |

## Optional robustness variations

After recording the clean cases, repeat selected cases with:

- A second speaker.
- A faster speaking speed.
- A slower speaking speed.
- Natural background conversation.
- Fan or light traffic noise.
- A different microphone.
- A natural Indian English accent.
- A small pause between the visitor name and the purpose.

Keep the reference text unchanged for these repetitions. Add a suffix to the
audio filename, for example:

```text
en-name-01-speaker2.webm
en-name-01-noise.webm
en-name-01-slow.webm
```

Do not alter the reference transcript merely because a model transcribes it
differently. The reference is the ground truth used for WER and CER.
