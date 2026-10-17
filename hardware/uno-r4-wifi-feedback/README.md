# UNO R4 WiFi feedback setup

**Current default: USB feedback.** Follow [USB-SETUP.md](USB-SETUP.md). The Wi-Fi implementation and instructions below are preserved for later, with its active firmware/server/UI entry points commented out.

The computer processes the webcam. This sketch receives only `idle`, `good`, or `off` over the local Wi-Fi network and drives your LEDs and passive buzzer. It receives no images, landmarks, or recordings. USB is needed for the initial upload and can then be replaced by a USB power bank. The practice page and its local feedback server must remain running.

## Before powering the circuit

- Green LED: D5 → **1 kΩ resistor** → LED anode; LED cathode → shared GND rail.
- Red LED: D6 → a separate **1 kΩ resistor** → LED anode; LED cathode → shared GND rail.
- Passive piezo buzzer: D8 → positive terminal; negative terminal → shared GND rail, **only if its specified pin current stays within 8 mA**. A magnetic buzzer or higher-current device needs a transistor driver appropriate to that device. Do not assume that an unspecified buzzer is safe to connect directly.
- Arduino GND → shared GND rail. The Arduino 5 V output pin is not used.

Replace the two existing 220 Ω resistors before use: ordinary LEDs can exceed this board's 8 mA per-pin limit with that resistance. Arduino specifies the GPIO limit and the board's USB-C power input in its [official datasheet](https://docs.arduino.cc/resources/datasheets/ABX00087-datasheet.pdf).

## One-time upload

1. Open Arduino IDE. In Boards Manager, install **Arduino UNO R4 Boards** by Arduino. Choose **Arduino UNO R4 WiFi**, not UNO R3 or UNO R4 Minima. See Arduino's [getting-started guide](https://docs.arduino.cc/tutorials/uno-r4-wifi/r4-wifi-getting-started/).
2. Open `hardware/uno-r4-wifi-feedback/uno-r4-wifi-feedback.ino`. Keep `FeedbackProtocol.h` in the same folder. WiFiS3 comes with the official board package; no third-party library is needed. This uses the same board networking API as Arduino's [WiFiS3 web-server example](https://github.com/arduino/ArduinoCore-renesas/blob/main/libraries/WiFiS3/examples/WiFiWebServer/WiFiWebServer.ino).
3. Open the **already generated local** `arduino_secrets.h` in that folder. Set `SECRET_SSID` to your **2.4 GHz** Wi-Fi network's actual name. For a password-protected network, set `SECRET_PASS` to its password. For an open network with no password, use `#define SECRET_PASS ""`; the sketch automatically selects WiFiS3's open-network connection method. Preserve `MOTIONTRIAL_SHARED_KEY`: the local app configuration already contains its matching random key. Never send your Wi-Fi password in chat or copy this private file into `public/`.
4. If the private file is missing, run `node scripts/prepare-arduino-config.mjs` from the project folder. It creates missing local configuration without replacing existing credentials. `arduino_secrets.example.h` is a placeholder-only reference, not a working credential file.
5. Connect the board by USB, select its port in Arduino IDE, and click **Upload**. Open Serial Monitor at **115200 baud**. It prints `MotionTrial UNO R4 WiFi protocol 1 ready. IP: ...` when connected. If you missed that startup message, send `?` in Serial Monitor to request the current IP again. This query is read-only and never activates or renews LED/buzzer feedback. It never prints your password or pairing key.
6. Note the printed local IP address. If it does not connect, check the credentials and 2.4 GHz network; the firmware retries automatically with the lights and buzzer off. A router restart can change the assigned IP. A DHCP reservation is optional.
7. After the upload, unplug from the computer and power the board through **USB-C using a suitable USB power bank or 5 V USB supply**. The sketch does not wait for Serial Monitor, so it starts on external USB power. Some power banks shut down at low load; check that yours stays on.

Use the computer and Arduino on the same local network. An open network must allow devices to connect without a webpage login or acceptance screen: this firmware cannot complete a captive portal. Public/guest Wi-Fi client isolation can prevent the app from reaching the Arduino even when both devices connect successfully. No router port forwarding, Arduino Cloud account, or internet endpoint is needed. This local HTTP protocol is authenticated but not encrypted; a private network or 2.4 GHz hotspot is preferable to public Wi-Fi.

For an open network, the two Wi-Fi settings look like this; replace only the network name and preserve the existing shared key:

```cpp
#define SECRET_SSID "ACTUAL_OPEN_WIFI_NAME"
#define SECRET_PASS ""
```

After saving, upload the sketch again, read its IP in Serial Monitor, and follow the app-pairing steps below. Open-network support uses the official [WiFiS3 one-argument `begin(ssid)` API](https://github.com/arduino/ArduinoCore-renesas/blob/main/libraries/WiFiS3/src/WiFi.h); a nonempty password retains the existing protected-network connection method. Physical public-network connectivity still needs testing with your board.

## Pair with MotionTrial

Run `node scripts/serve-dual-view.mjs` from the project folder. Open `http://127.0.0.1:8766/first-three.html`, then **Settings → Arduino Wi-Fi feedback · optional**. Enter the IP printed by the board in **Arduino IP address** and click **Connect Wi-Fi feedback**. The pairing key is already matched between the generated sketch header and the private server configuration; you do not need to enter your Wi-Fi credentials into the browser. Keep that server running during practice.

During a scored imitation:

| Observed state | Hardware |
| --- | --- |
| All four fresh hand/foot points within the broad guidelines | Green steady; red off; silent |
| A fresh point remains outside its guideline | Green off; red flashes; short repeated 2 kHz beeps |
| Tracking unclear, preparation, demonstration, pause, or disconnect | Both LEDs off; silent |

The browser applies brief entry/exit delays so isolated jitter does not produce an alarm. These live cues do not replace the full movement assessment at the end of a clip.

## Protocol and timeout behavior

The board listens on TCP port **80**. Every request requires `X-MotionTrial-Key: <the private shared key>`. The key is 32–64 hexadecimal characters. Never put it in a URL.

- `GET /motiontrial/status` reads state; it does **not** renew the output lease.
- `POST /motiontrial/feedback`, `Content-Type: text/plain`, explicit `Content-Length`, body **exactly** `idle\n`, `good\n`, or `off\n` (the final `\n` is one LF byte).
- A successful reply is JSON: `{"device":"motiontrial-uno-r4-wifi","protocol":1,"state":"idle"}` with the current state substituted.
- Only a complete, authenticated, valid POST can change outputs or renew their **900 ms lease**. Wrong keys, malformed/oversized requests, other paths or verbs, partial bodies, and GET requests do not renew it.
- Startup, Wi-Fi reconnection, and detected disconnection clear outputs. A request has a fixed **350 ms** processing deadline, a maximum header budget, and bounded per-loop reads. There is no wait for a whole request, Serial Monitor, or a blocking `delay()`.
- The lease uses `millis()` and is checked around network calls. WiFiS3 itself may block inside its vendor modem API; this is a cooperative timeout, not a certified real-time safety mechanism. The buzzer uses an 80 ms tone duration and the firmware requests silence before reconnecting. Real device timing still needs the checks below.

## Validation and physical check

Run `node scripts/check-arduino-firmware.mjs` to compile and execute the actual C++ protocol/lease/output logic on the computer. This checks invalid authentication, bad commands, partial requests, unchanged read-only GET leases, timeout/clock rollover, and LED/beep patterns. It also checks sketch pin assignments and no Serial wait/credential logging. Host tests do not upload firmware or verify electrical behavior.

The current sketch compiled successfully for **`arduino:renesas_uno:unor4wifi` using the official UNO R4 core 1.6.0**: 66,212 bytes of program storage and 7,956 bytes of global dynamic memory. The build used a private project toolchain cache. The host suite passed 4,006 protocol/lease/output assertions plus 71 protected-network and 70 open-network checks against the actual sketch using explicitly simulated network, GPIO, and clock doubles. The sketch was also uploaded to the real board and joined an open network; on that public network, app-to-board TCP requests timed out. Successful Wi-Fi association alone does not prove that the network permits device-to-device communication, and physical LED/buzzer acceptance is still pending.

After uploading, physically check:

1. On startup and while idle, both LEDs and the buzzer remain off.
2. During a valid within-guideline imitation, green stays on and the buzzer stays silent.
3. Move a tracked hand outside the guide: red flashes and short beeps repeat; return inside and green resumes.
4. Cover the camera or stop practice: outputs return to silent idle, not red or green success.
5. Close the page, stop the local server, and interrupt Wi-Fi separately: outputs return to idle. Measure real timeout latency if it matters to your use.
6. Restart the Arduino using power-bank power only; it should reconnect and appear in app settings without USB to the computer.

No physical upload, buzzer-current measurement, LED observation, or live Arduino Wi-Fi test is implied by the automated checks.
