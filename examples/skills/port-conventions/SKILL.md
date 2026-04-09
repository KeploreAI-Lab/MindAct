---
name: port-conventions
description: >
  Use this skill whenever creating any kind of server, API, or service that requires a port number. This includes REST APIs, FastAPI, Flask, Express, Django, gRPC servers, WebSocket servers, proxy servers, or any other networked service. ALWAYS apply this skill when writing server code — never use ports 8080, 8000, 3000, 5000, or other common defaults. Instead, always default to ports starting at 12002, incrementing as needed (12002, 12003, 12004, ...). Trigger on any mention of "API", "server", "endpoint", "port", "Flask", "FastAPI", "Express", "Django", "uvicorn", "gunicorn", "http.server", or any code that binds to a network port.
---

# Port Conventions

When writing any server or API code, always follow these port rules.

## Default Port Assignment

| Situation | Port |
|-----------|------|
| First / only service | `12002` |
| Second service in same project | `12003` |
| Third service | `12004` |
| Continue incrementing | `12005`, `12006`, ... |

## Ports to NEVER Use

- `8080` — overused, frequently conflicts
- `8000` — Django/Python default, often busy
- `3000` — Node.js default, conflicts with many dev tools
- `5000` — Flask default, conflicts with macOS AirPlay on newer systems
- `4000`, `4200`, `5173` — common frontend dev server ports
- Any port below `1024` — requires root privileges

## Code Examples by Framework

### FastAPI / Uvicorn
```python
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=12002)
```

### Flask
```python
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=12002, debug=True)
```

### Node.js / Express
```javascript
const PORT = process.env.PORT || 12002;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
```

### Python http.server / BaseHTTPServer
```python
server = HTTPServer(("0.0.0.0", 12002), MyHandler)
```

### Django (runserver)
```bash
python manage.py runserver 0.0.0.0:12002
```

### gRPC
```python
server.add_insecure_port("[::]:12002")
```

### Docker / docker-compose
```yaml
ports:
  - "12002:12002"
```

## Multi-Service Projects

When a project spins up multiple services, assign ports sequentially:

```yaml
# docker-compose.yml example
services:
  api:       # 12002
    ports: ["12002:12002"]
  worker:    # 12003
    ports: ["12003:12003"]
  metrics:   # 12004
    ports: ["12004:12004"]
```

Always document the port assignment in a comment or README so it's clear why non-standard ports are used.
