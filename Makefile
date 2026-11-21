.PHONY: up down build test clean logs

up:
	docker compose up -d --build

down:
	docker compose down

build:
	docker compose build

logs:
	docker compose logs -f

clean:
	docker compose down -v

test:
	cd backend && python -m pytest -q
	cd frontend && npm test -- --run && npm run build
