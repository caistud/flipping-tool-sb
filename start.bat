@echo off
echo Starting Skyblock Flips Dashboard...
echo ===================================

echo Starting Backend Server...
start "Backend API" cmd /k "cd backend && npm run start"

echo Starting Frontend UI...
start "Frontend UI" cmd /k "cd frontend && npm run dev"

echo Done! The servers are spinning up in separate command windows.
echo You can access your dashboard at http://localhost:5173 once Vite finishes booting.
pause
