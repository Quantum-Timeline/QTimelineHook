import json
import sys

request = json.loads(sys.stdin.read())
reference_path, seed_hex = request["referencePath"], request["seed"]
sys.path.insert(0, reference_path)

from dilithium_py.dilithium.default_parameters import Dilithium2
from dilithium_py.shake.shake_wrapper import shake128, shake256

if len(seed_hex) != 64:
    raise SystemExit("ML-DSA-44 KeyGen seed must be 32 bytes")
seed = bytes.fromhex(seed_hex)
public_key, _ = Dilithium2.key_derive(seed, _xof=shake256, _xof2=shake128)
if len(public_key) != 1312:
    raise SystemExit("Pinned FIPS 204 reference returned an invalid public-key length")
print(public_key.hex())
