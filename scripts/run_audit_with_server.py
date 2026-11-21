#!/usr/bin/env python3
"""Starts a local test backend with mock LLM responses and runs contract_audit.py."""
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request


def wait_for_server(url: str, timeout: float = 25.0) -> bool:
    start = time.time()
    while time.time() - start < timeout:
        try:
            with urllib.request.urlopen(f"{url}/health", timeout=1) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            time.sleep(0.3)
    return False


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    backend_dir = os.path.join(root, "backend")
    audit_script = os.path.join(root, "scripts", "contract_audit.py")
    db_file = os.path.join(backend_dir, "test_audit_runner.db")

    if os.path.exists(db_file):
        try:
            os.remove(db_file)
        except Exception:
            pass

    env = dict(os.environ)
    env.update({
        "LLM_API_KEYS": "key_1,key_2",
        "LLM_MODEL": "gemini/gemini-2.0-flash",
        "LLM_MOCK_RESPONSE": "Audit mock reply.",
        "ENABLE_FAILURE_SIMULATION": "true",
        "DATABASE_URL": f"sqlite:///{db_file.replace(os.sep, '/')}",
        "CACHE_ENABLED": "true",
        "RATE_LIMIT_PER_MINUTE": "120",
    })

    python_bin = sys.executable
    port = 8000
    server_url = f"http://127.0.0.1:{port}"

    print(f"==> Launching backend on {server_url} ...", flush=True)
    server_log = open(os.path.join(backend_dir, "test_server.log"), "w")
    proc = subprocess.Popen(
        [python_bin, "-u", "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)],
        cwd=backend_dir,
        env=env,
        stdout=server_log,
        stderr=server_log,
    )

    try:
        ready = wait_for_server(server_url, timeout=30.0)
        if not ready:
            print("ERROR: Server failed to start within 30s", flush=True)
            server_log.flush()
            if os.path.exists(os.path.join(backend_dir, "test_server.log")):
                with open(os.path.join(backend_dir, "test_server.log"), "r") as f:
                    print("--- SERVER LOG ---", flush=True)
                    print(f.read(), flush=True)
                    print("--- END SERVER LOG ---", flush=True)
            sys.exit(1)

        print("==> Backend is ready! Running contract_audit.py ...", flush=True)
        audit_res = subprocess.run([python_bin, audit_script, server_url])
        if audit_res.returncode != 0:
            print("ERROR: contract_audit.py failed!", flush=True)
            sys.exit(audit_res.returncode)

        print("==> All local backend audits passed successfully!", flush=True)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except Exception:
            proc.kill()
        server_log.close()
        if os.path.exists(db_file):
            try:
                os.remove(db_file)
            except Exception:
                pass
        log_file = os.path.join(backend_dir, "test_server.log")
        if os.path.exists(log_file):
            try:
                os.remove(log_file)
            except Exception:
                pass


if __name__ == "__main__":
    main()
