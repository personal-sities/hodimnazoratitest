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
TMP_PROFILE = os.path.join(r"C:\Users\Diyor\AppData\Local\Temp", f"chrome_pbx_{int(time.time())}")

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
            # Wait for page scripts to load and showPage to be defined
            for _ in range(30):
                chk = await cdp_call(ws, "Runtime.evaluate", {"expression": "typeof showPage === 'function' && typeof setPbxDatePreset === 'function'", "returnByValue": True})
                if chk.get("result", {}).get("value") is True:
                    break
                await asyncio.sleep(0.5)

            # 1. Switch to admin and PBX tab, select TODAY (30.10.2026)
            setup_script_today = """
            (() => {
                try {
                    showPage('admin');
                    adminTab('pbx');
                    setPbxDatePreset('today');
                    return { ok: true };
                } catch(e) {
                    return { ok: false, error: e.message };
                }
            })()
            """
            res_td = await cdp_call(ws, "Runtime.evaluate", {
                "expression": setup_script_today,
                "returnByValue": True
            }, 3)
            print("Setup script today result:", res_td.get("result", {}).get("value"))

            await asyncio.sleep(1.5)

            inspect_script_today = """
            (() => {
                const total = document.getElementById('pbx_stat_total')?.textContent?.trim();
                const answered = document.getElementById('pbx_stat_answered')?.textContent?.trim();
                const missed = document.getElementById('pbx_stat_missed')?.textContent?.trim();
                const duration = document.getElementById('pbx_stat_duration')?.textContent?.trim();
                const fromVal = document.getElementById('pbx_date_from')?.value;
                const toVal = document.getElementById('pbx_date_to')?.value;
                const quota = document.getElementById('pbx_formula_z')?.textContent?.trim();
                const hist30 = window.PBX_HISTORICAL_STATS ? window.PBX_HISTORICAL_STATS['2026-10-30'] : null;

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
                    quota,
                    hist30,
                    rows
                };
            })()
            """
            eval_res_td = await cdp_call(ws, "Runtime.evaluate", {
                "expression": inspect_script_today,
                "returnByValue": True
            }, 4)
            val_td = eval_res_td.get("result", {}).get("value", {})

            print("\n==================================================")
            print("   [1] BUGUNGI KUN (30.10.2026) UI NATIJALARI     ")
            print("==================================================")
            print(f"Tanlangan sana: {val_td.get('fromVal')} dan {val_td.get('toVal')} gacha (Bugun)")
            print(f"UI Kiruvchi (pbx_stat_total)   : {val_td.get('total')}")
            print(f"UI Gaplashilgan (pbx_stat_ans) : {val_td.get('answered')}")
            print(f"UI Propushnniy (pbx_stat_miss) : {val_td.get('missed')}")
            print(f"UI Suhbat vaqti (pbx_stat_dur) : {val_td.get('duration')}")
            print(f"UI Norma Z (pbx_formula_z)     : {val_td.get('quota')}")
            print(f"window.PBX_HISTORICAL_STATS['2026-10-30']: {json.dumps(val_td.get('hist30'), indent=2, ensure_ascii=False)}")
            print("--------------------------------------------------")
            print("Operatorlar jadvali (Bugun):")
            for r in val_td.get('rows', []):
                line = " | ".join(r)
                print(line.encode("ascii", "replace").decode("ascii"))
            print("==================================================")

            # Capture today screenshot
            ss_td = await cdp_call(ws, "Page.captureScreenshot", {"format": "png"}, 5)
            img_data_td = ss_td.get("data")
            if img_data_td:
                artifact_dir = r"C:\Users\Diyor\.gemini\antigravity-ide\brain\228c720f-3433-4e28-bb81-09a8e5f01308"
                out_path_td = os.path.join(artifact_dir, "pbx_today_verified.png")
                with open(out_path_td, "wb") as f:
                    f.write(base64.b64decode(img_data_td))
                print(f"Bugungi screenshot saqlandi: {out_path_td}")

            # 2. Select YESTERDAY (29.10.2026)
            setup_script_yest = """
            (() => {
                try {
                    setPbxDatePreset('yesterday');
                    return { ok: true };
                } catch(e) {
                    return { ok: false, error: e.message };
                }
            })()
            """
            await cdp_call(ws, "Runtime.evaluate", {
                "expression": setup_script_yest,
                "returnByValue": True
            }, 6)
            await asyncio.sleep(1.5)

            inspect_script_yest = """
            (() => {
                const total = document.getElementById('pbx_stat_total')?.textContent?.trim();
                const answered = document.getElementById('pbx_stat_answered')?.textContent?.trim();
                const missed = document.getElementById('pbx_stat_missed')?.textContent?.trim();
                const duration = document.getElementById('pbx_stat_duration')?.textContent?.trim();
                const fromVal = document.getElementById('pbx_date_from')?.value;
                const toVal = document.getElementById('pbx_date_to')?.value;
                const quota = document.getElementById('pbx_formula_z')?.textContent?.trim();

                const rows = [];
                const tbody = document.getElementById('pbx_operators_body');
                if (tbody) {
                    Array.from(tbody.querySelectorAll('tr')).forEach(tr => {
                        const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim().replace(/\\s+/g, ' '));
                        if (cells.length > 0) rows.push(cells);
                    });
                }

                return { total, answered, missed, duration, fromVal, toVal, quota, rows };
            })()
            """
            eval_res_yest = await cdp_call(ws, "Runtime.evaluate", {
                "expression": inspect_script_yest,
                "returnByValue": True
            }, 7)
            val_yest = eval_res_yest.get("result", {}).get("value", {})

            print("\n==================================================")
            print("   [2] KECHAGI KUN (29.10.2026) UI NATIJALARI    ")
            print("==================================================")
            print(f"Tanlangan sana: {val_yest.get('fromVal')} dan {val_yest.get('toVal')} gacha (Kecha)")
            print(f"UI Kiruvchi (pbx_stat_total)   : {val_yest.get('total')}")
            print(f"UI Gaplashilgan (pbx_stat_ans) : {val_yest.get('answered')}")
            print(f"UI Propushnniy (pbx_stat_miss) : {val_yest.get('missed')}")
            print(f"UI Suhbat vaqti (pbx_stat_dur) : {val_yest.get('duration')}")
            print(f"UI Norma Z (pbx_formula_z)     : {val_yest.get('quota')}")
            print("--------------------------------------------------")
            print("Operatorlar jadvali (Kecha):")
            for r in val_yest.get('rows', []):
                line = " | ".join(r)
                print(line.encode("ascii", "replace").decode("ascii"))
            print("==================================================")

            # Capture yesterday screenshot
            ss_yest = await cdp_call(ws, "Page.captureScreenshot", {"format": "png"}, 8)
            img_data_yest = ss_yest.get("data")
            if img_data_yest:
                artifact_dir = r"C:\Users\Diyor\.gemini\antigravity-ide\brain\228c720f-3433-4e28-bb81-09a8e5f01308"
                out_path_yest = os.path.join(artifact_dir, "pbx_yesterday_verified.png")
                with open(out_path_yest, "wb") as f:
                    f.write(base64.b64decode(img_data_yest))
                print(f"Kechagi screenshot saqlandi: {out_path_yest}")

    finally:
        proc.terminate()

if __name__ == "__main__":
    asyncio.run(main())
