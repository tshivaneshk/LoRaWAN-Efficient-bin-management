"""Key management and CLI generator for Northgate LoRaWAN backend.

Keys:
- TRANSPORT_KEY: 16-byte AES-128 key (32 hex characters) used for serial_bridge to backend communication.
- STORAGE_KEY: 16-byte AES-128 key (32 hex characters) used for at-rest database field encryption.
"""
from __future__ import annotations

import json
import os
import secrets
import sys

from . import aes_ccm

KEYS_FILE_DEFAULT = "data/keys.json"


def get_key_from_env_or_file(env_name: str, key_name: str, keys_file: str = KEYS_FILE_DEFAULT) -> bytes:
    """Retrieve 16-byte key from environment or local JSON file.

    If not in env and not in file, generate new random keys into keys_file once,
    never logging or printing the keys.
    """
    env_val = os.getenv(env_name)
    if env_val:
        env_val = env_val.strip()
        try:
            key_bytes = bytes.fromhex(env_val)
        except ValueError as exc:
            raise ValueError(f"{env_name} must be a 32-character hexadecimal string") from exc
        if len(key_bytes) != aes_ccm.KEY_LENGTH:
            raise ValueError(f"{env_name} has invalid length ({len(key_bytes)} bytes); expected exactly {aes_ccm.KEY_LENGTH} bytes (32 hex chars)")
        return key_bytes

    # Check keys_file
    keys = {}
    if os.path.exists(keys_file):
        try:
            with open(keys_file, "r", encoding="utf-8") as f:
                keys = json.load(f)
        except Exception:
            keys = {}

    if key_name in keys and isinstance(keys[key_name], str):
        val = keys[key_name].strip()
        try:
            key_bytes = bytes.fromhex(val)
        except ValueError as exc:
            raise ValueError(f"Key '{key_name}' in {keys_file} is not valid hex") from exc
        if len(key_bytes) != aes_ccm.KEY_LENGTH:
            raise ValueError(f"Key '{key_name}' in {keys_file} must be {aes_ccm.KEY_LENGTH} bytes (32 hex characters)")
        return key_bytes

    # Generate fresh keys into keys_file without printing key values
    os.makedirs(os.path.dirname(keys_file) or ".", exist_ok=True)
    if "TRANSPORT_KEY" not in keys:
        keys["TRANSPORT_KEY"] = secrets.token_hex(16)
    if "STORAGE_KEY" not in keys:
        keys["STORAGE_KEY"] = secrets.token_hex(16)

    with open(keys_file, "w", encoding="utf-8") as f:
        json.dump(keys, f, indent=2)

    # Let the user know where keys were stored without printing secret contents
    print(f"[keys] generated keys into {keys_file}", flush=True)

    return bytes.fromhex(keys[key_name])


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "generate":
        target = ".env.example" if len(sys.argv) <= 2 else sys.argv[2]
        t_key = secrets.token_hex(16)
        s_key = secrets.token_hex(16)
        content = (
            f"# Northgate Smart Bin Configuration\n"
            f"TRANSPORT_KEY={t_key}\n"
            f"STORAGE_KEY={s_key}\n"
            f"ENFORCE_ENCRYPTION=1\n"
            f"WS_ENCRYPT=0\n"
            f"API_KEY=\n"
            f"ENABLE_DEMO=1\n"
        )
        with open(target, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"[keytool] generated template with fresh keys to {target}", flush=True)
    else:
        print("Usage: python -m app.keytool generate [.env.example]")


if __name__ == "__main__":
    main()
