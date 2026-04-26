from fastapi import WebSocket
from typing import Dict, List

class ConnectionManager:
    def __init__(self):
        self.active: Dict[int, List[WebSocket]] = {}

    async def connect(self, trip_id: int, websocket: WebSocket):
        await websocket.accept()
        self.active.setdefault(trip_id, []).append(websocket)

    def disconnect(self, trip_id: int, websocket: WebSocket):
        if trip_id in self.active and websocket in self.active[trip_id]:
            self.active[trip_id].remove(websocket)

    async def broadcast(self, trip_id: int, payload: dict):
        for ws in list(self.active.get(trip_id, [])):
            try:
                await ws.send_json(payload)
            except Exception:
                self.disconnect(trip_id, ws)

manager = ConnectionManager()
