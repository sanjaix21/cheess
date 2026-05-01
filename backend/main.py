import subprocess
import asyncio
import httpx
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# Allow frontend to talk to server

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/games/{username}/{year}/{month}")
async def get_games(username: str, year: int, month: int):
    mm = str(month).zfill(2)  # 4 → "04"
    url = f"https://api.chess.com/pub/player/{username}/games/{year}/{mm}"
    async with httpx.AsyncClient() as client:
        r = await client.get(url, headers={"User-Agent": "chess-app"})
        return r.json()

@app.websocket("/engine")
async def engine_ws(ws: WebSocket):
    await ws.accept()

    sf = subprocess.Popen(
        ["stockfish"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        bufsize=1
    )

    async def read_sf():
        loop = asyncio.get_event_loop()
        while True:
            line = await loop.run_in_executor(None, sf.stdout.readline)
            if not line:
                break
            await ws.send_text(line.strip())

    reader = asyncio.create_task(read_sf())

    try: 
        while True:
            msg = await ws.receive_text()
            sf.stdin.write(msg+ "\n")
            sf.stdin.flush()
    except Exception:
        pass

    finally:
        reader.cancel()
        sf.terminate()
