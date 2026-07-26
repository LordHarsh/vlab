import { BrowserRouter, Routes, Route, Navigate, useParams, useNavigate } from 'react-router-dom';
import { LandingPage } from './components/LandingPage';
import { Dashboard } from './components/Dashboard';
import { SimulatorWorkspace } from './components/SimulatorWorkspace';
import { useStore } from './utils/store';
import { useAuth } from './utils/useAuth';
import React from 'react';
import { Loader2 } from 'lucide-react';

// Wrapper for simulator page to grab param
const SimulatorRouteWrapper: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const experiments = useStore(state => state.experiments);

  const isUuid = id ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) : false;

  if (isUuid) {
    const mockExperiment: any = {
      id: -1,
      title: 'Loading Circuit...',
      description: 'Your Supabase design is loading...',
      platform: 'Arduino',
      keyComponents: [],
      defaultCode: '',
      defaultComponents: [],
      defaultWires: [],
    };
    return (
      <SimulatorWorkspace
        experiment={mockExperiment}
        circuitId={id}
        onBack={() => navigate('/dashboard')}
      />
    );
  }

  const experiment = experiments.find(e => e.id === Number(id));

  if (!experiment) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <SimulatorWorkspace
      experiment={experiment}
      onBack={() => navigate('/dashboard')}
    />
  );
};

// Route protection wrapper — uses real Supabase session
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#FF6B35] animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

// Redirect if already logged in
const AuthRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#FF6B35] animate-spin" />
      </div>
    );
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route 
          path="/" 
          element={
            <AuthRoute>
              <LandingPage />
            </AuthRoute>
          } 
        />
        <Route 
          path="/dashboard" 
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/simulator/:id" 
          element={
            <ProtectedRoute>
              <SimulatorRouteWrapper />
            </ProtectedRoute>
          } 
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
