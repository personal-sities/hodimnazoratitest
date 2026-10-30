import asyncio
import json
import os
import subprocess
import time
import urllib.request
import base64
import websockets

CHROME_PATH = r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
URL = "http://localhost:8080/index.html"
PORT = 9222
TMP_PROFILE = r"C:\Users\Diyor\AppData\Local\Temp\chrome_pbx_verify"

async def cdp_call(ws, method, params=None, msg_id=1):
    req = {"id": msg_id, "method": method, "params": params or {}}
    await ws.send(json.dumps(req))
    while True:
        resp = await ws.recv()
        data = json.loads(resp)
        if data.get("id") == msg_id:
            return data.get("result", {})

async def main():
    cmd = [
        CHROME_PATH,
        "--headless=new",
        "--disable-gpu",
        f"--remote-debugging-port={PORT}",
        f"--user-data-dir={TMP_PROFILE}",
        "--window-size=1400,1000",
        URL
    ]
    proc = subprocess.Popen(cmd)
    try:
        # Wait for debugging port
        for _ in range(20):
            try:
                with urllib.request.urlopen(f"http://localhost:{PORT}/json", timeout=1) as r:
                    tabs = json.loads(r.read().decode())
                    break
            except Exception:
                time.sleep(0.3)
        else:
            raise Exception("Chrome debugging port timed out")

        # Find AloqaPro tab
        target_tab = None
        for t in tabs:
            if t.get("type") == "page" and "8080" in t.get("url", ""):
                target_tab = t
                break
        if not target_tab:
            for t in tabs:
                if t.get("type") == "page":
                    target_tab = t
                    break

        ws_url = target_tab["webSocketDebuggerUrl"]
        print(f"Connecting to Chrome DevTools at {ws_url}...")

        async with websockets.connect(ws_url) as ws:
            # Enable Page and Runtime
            await cdp_call(ws, "Page.enable", {}, 1)
            await cdp_call(ws, "Runtime.enable", {}, 2)

            # Wait 2 seconds for scripts to load
            await asyncio.sleep(2)

            # Switch to admin and PBX tab, select yesterday
            setup_script = """
            (() => {
                try {
                    showPage('admin');
                    adminTab('pbx');
                    setPbxDatePreset('yesterday');
                    return { ok: true };
                } catch(e) {
                    return { ok: false, error: e.message };
                }
            })()
            """
            res = await cdp_call(ws, "Runtime.evaluate", {
                "expression": setup_script,
                "returnByValue": True
            }, 3)
            print("Setup script result:", res.get("result", {}).get("value"))

            # Wait 1.5 seconds for UI render
            await asyncio.sleep(1.5)

            # Inspect elements
            inspect_script = """
            (() => {
                const total = document.getElementById('pbx_stat_total')?.textContent?.trim();
                const answered = document.getElementById('pbx_stat_answered')?.textContent?.trim();
                const missed = document.getElementById('pbx_stat_missed')?.textContent?.trim();
                const duration = document.getElementById('pbx_stat_duration')?.textContent?.trim();
                const fromVal = document.getElementById('pbx_date_from')?.value;
                const toVal = document.getElementById('pbx_date_to')?.value;
                const hist29 = window.PBX_HISTORICAL_STATS ? window.PBX_HISTORICAL_STATS['2026-10-29'] : null;

                const rows = [];
                const tbody = document.getElementById('pbx_operators_body');
                if (tbody) {
                    Array.from(tbody.querySelectorAll('tr')).forEach(tr => {
                        const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim().replace(/\\s+/g, ' '));
                        if (cells.length > 0) rows.push(cells);
                    });
                }

                return {
                    total,
                    answered,
                    missed,
                    duration,
                    fromVal,
                    toVal,
                    hist29,
                    rows
                };
            })()
            """
            eval_res = await cdp_call(ws, "Runtime.evaluate", {
                "expression": inspect_script,
                "returnByValue": True
            }, 4)
            val = eval_res.get("result", {}).get("value", {})

            print("==================================================")
            print("       BRAUZER UI TEKSHIRUVI NATIJALARI           ")
            print("==================================================")
            print(f"Tanlangan sana oralig'i: {val.get('fromVal')} dan {val.get('toVal')} gacha (Kecha)")
            print(f"UI Kiruvchi (pbx_stat_total)   : {val.get('total')}")
            print(f"UI Gaplashilgan (pbx_stat_ans) : {val.get('answered')}")
            print(f"UI Propushnniy (pbx_stat_miss) : {val.get('missed')}")
            print(f"UI Suhbat vaqti (pbx_stat_dur) : {val.get('duration')}")
            print("--------------------------------------------------")
            print("window.PBX_HISTORICAL_STATS['2026-10-29']:")
            print(json.dumps(val.get('hist29'), indent=2, ensure_ascii=False))
            print("--------------------------------------------------")
            print("Operatorlar jadvali (UI dagi satrlar):")
            for r in val.get('rows', []):
                line = " | ".join(r)
                print(line.encode("ascii", "replace").decode("ascii"))
            print("==================================================")

            # Capture screenshot
            ss = await cdp_call(ws, "Page.captureScreenshot", {"format": "png"}, 5)
            img_data = ss.get("data")
            if img_data:
                artifact_dir = r"C:\Users\Diyor\.gemini\antigravity-ide\brain\228c720f-3433-4e28-bb81-09a8e5f01308"
                out_path = os.path.join(artifact_dir, "pbx_yesterday_verified.png")
                with open(out_path, "wb") as f:
                    f.write(base64.b64decode(img_data))
                print(f"Screenshot saved to: {out_path}")

    finally:
        proc.terminate()

if __name__ == "__main__":
    asyncio.run(main())
