# Convenience aliases for the AI-Trader development platform.
# The platform itself is pure Node (see dev/), so the `npm run …` forms work
# everywhere. These targets are shorthand for people who reach for make.

.PHONY: dev core backend frontend mcp workers research trading analytics \
        doctor status dashboard logs health ports graph clean stop restart \
        plan list install test help

## dev: start every enabled service (profile: full)
dev:
	npm run dev

## core: start the core profile (backend + frontend + mcp)
core:
	npm run dev:core
backend:  ; npm run dev:backend
frontend: ; npm run dev:frontend
mcp:      ; npm run dev:mcp
workers:  ; npm run dev:workers
research: ; npm run dev:research
trading:  ; npm run dev:trading
analytics:; npm run dev:analytics

## doctor: validate the development environment
doctor:    ; npm run doctor
## status: one-shot snapshot of running services
status:    ; npm run status
## dashboard: live auto-refreshing dashboard
dashboard: ; npm run dashboard
## logs: follow unified service logs
logs:      ; npm run logs
## health: probe all service health endpoints
health:    ; npm run health
## ports: show port ownership
ports:     ; npm run ports
## graph: validate deps + regenerate dev/GRAPH.md
graph:     ; npm run graph
## clean: remove runtime logs + state
clean:     ; npm run clean
## stop: stop everything cleanly
stop:      ; npm run stop
## restart: stop, then start the last profile
restart:   ; npm run restart
## plan: show start plan + port check (start nothing)
plan:      ; npm run dev:plan
## list: list all registry services
list:      ; npm run dev:list
## test: run infrastructure tests
test:      ; npm run test:dev
## install: install root dependencies
install:   ; npm install

## help: list available targets
help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## //'
