import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Navbar from './components/Navbar'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import JobDetail from './pages/JobDetail'
import Charts from './pages/Charts'
import Admin from './pages/Admin'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="min-h-screen bg-gray-50">
          <Routes>
            {/* Public */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />

            {/* Protected — all wrapped in Navbar */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <>
                    <Navbar />
                    <main className="max-w-7xl mx-auto px-4 py-6">
                      <Navigate to="/dashboard" replace />
                    </main>
                  </>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <>
                    <Navbar />
                    <main className="max-w-7xl mx-auto px-4 py-6">
                      <Dashboard />
                    </main>
                  </>
                </ProtectedRoute>
              }
            />
            <Route
              path="/jobs/:id"
              element={
                <ProtectedRoute>
                  <>
                    <Navbar />
                    <main className="max-w-7xl mx-auto px-4 py-6">
                      <JobDetail />
                    </main>
                  </>
                </ProtectedRoute>
              }
            />
            <Route
              path="/charts"
              element={
                <ProtectedRoute>
                  <>
                    <Navbar />
                    <main className="max-w-7xl mx-auto px-4 py-6">
                      <Charts />
                    </main>
                  </>
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <ProtectedRoute>
                  <>
                    <Navbar />
                    <main className="max-w-7xl mx-auto px-4 py-6">
                      <Admin />
                    </main>
                  </>
                </ProtectedRoute>
              }
            />
          </Routes>
        </div>
      </BrowserRouter>
    </AuthProvider>
  )
}
