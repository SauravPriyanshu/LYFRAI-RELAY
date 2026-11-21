import os
import sys
from pathlib import Path
from dotenv import load_dotenv

os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")
os.environ.setdefault("LITELLM_TELEMETRY", "False")

# Point package search path to backend/app and ensure backend is on sys.path
backend_dir = Path(__file__).resolve().parent.parent / "backend"
if (backend_dir / ".env").is_file():
    load_dotenv(backend_dir / ".env")
load_dotenv()

if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

backend_app_dir = backend_dir / "app"
__path__ = [str(backend_app_dir)]
