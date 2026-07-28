"""
PlatformIO pre-build hook: load esp32/.env and inject the values as -D build
flags, so credentials live in .env (git-ignored) instead of config.h.

Wired up via `extra_scripts = pre:scripts/load_env.py` in platformio.ini.

- String keys  -> -DKEY="value"   (properly escaped for the C preprocessor)
- Int keys     -> -DKEY=value
- Keys absent from .env keep the defaults in include/config.h.
- Empty values: kept for strings (e.g. anonymous MQTT), skipped for ints.
"""
import os

Import("env")  # noqa: F821  (provided by PlatformIO/SCons)

STRING_KEYS = {
    "WIFI_SSID", "WIFI_PASSWORD",
    "MQTT_HOST", "MQTT_USER", "MQTT_PASS", "MQTT_BASE_TOPIC",
    "NTP_SERVER_1", "NTP_SERVER_2", "TZ_INFO",
    "AP_NAME", "AP_PASSWORD", "HOSTNAME",
}
INT_KEYS = {
    "MQTT_PORT", "DS200_BAUD", "DS200_RX_PIN", "DS200_TX_PIN",
    "WIFI_CONNECT_TIMEOUT", "PORTAL_TIMEOUT",
}


def parse_dotenv(path):
    values = {}
    if not os.path.isfile(path):
        return values
    with open(path, "r", encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            key = key.strip()
            val = val.strip()
            # strip optional surrounding quotes
            if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
                val = val[1:-1]
            values[key] = val
    return values


project_dir = env["PROJECT_DIR"]  # noqa: F821
env_path = os.path.join(project_dir, ".env")
values = parse_dotenv(env_path)

defines = []
for key, val in values.items():
    if key in STRING_KEYS:
        defines.append((key, env.StringifyMacro(val)))  # noqa: F821
    elif key in INT_KEYS:
        if val == "":
            continue
        defines.append((key, val))
    # unknown keys are ignored on purpose

if defines:
    env.Append(CPPDEFINES=defines)  # noqa: F821
    print("[load_env] %d value(s) from .env override config.h: %s"
          % (len(defines), ", ".join(k for k, _ in defines)))
else:
    print("[load_env] no .env found (using config.h defaults): %s" % env_path)
