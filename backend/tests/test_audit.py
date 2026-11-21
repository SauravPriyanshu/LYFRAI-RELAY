import json
import sys
from pathlib import Path

# Add project root and scripts directory to sys.path
root_dir = Path(__file__).resolve().parent.parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))
scripts_dir = root_dir / "scripts"
if str(scripts_dir) not in sys.path:
    sys.path.insert(0, str(scripts_dir))

try:
    from scripts.contract_audit import AuditRunner
except ImportError:
    pass


class ClientAuditRunner(AuditRunner):
    """Adapts AuditRunner to use FastAPI TestClient directly in pytest."""

    def __init__(self, test_client):
        super().__init__("http://testserver")
        self.client = test_client

    def request(self, method: str, path: str, data=None, headers=None):
        req_headers = dict(headers or {})
        content = None
        json_body = None

        if isinstance(data, dict):
            json_body = data
        elif isinstance(data, bytes):
            content = data

        resp = self.client.request(
            method=method,
            url=path,
            json=json_body,
            content=content,
            headers=req_headers,
        )
        try:
            parsed = resp.json()
        except Exception:
            parsed = resp.text
        return resp.status_code, parsed, dict(resp.headers)


def test_contract_audit_suite(client):
    runner = ClientAuditRunner(client)
    success = runner.run_all()
    assert success, f"Contract audit had {runner.failed} failures"
    assert runner.passed >= 20
