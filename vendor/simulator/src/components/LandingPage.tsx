import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, Mail, Lock, User, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { HeaderBranding } from './features/HeaderBranding';
import { useAuth } from '../utils/useAuth';

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const { signIn, signUp, resetPassword, isLoading: authLoading } = useAuth();

  // Tabs: 'login' | 'signup'
  const [activeTab, setActiveTab] = useState<'login' | 'signup'>('login');

  // Shared loading & success states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  // Login fields
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  // Signup fields
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirm, setSignupConfirm] = useState('');
  const [signupError, setSignupError] = useState('');

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    if (!loginEmail || !loginPassword) {
      setLoginError('Please fill in all fields.');
      return;
    }
    setIsSubmitting(true);
    const { error } = await signIn(loginEmail, loginPassword);
    setIsSubmitting(false);
    if (error) {
      setLoginError(error);
      return;
    }
    navigate('/dashboard');
  };

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignupError('');
    if (!signupName || !signupEmail || !signupPassword || !signupConfirm) {
      setSignupError('Please fill in all fields.');
      return;
    }
    if (signupPassword !== signupConfirm) {
      setSignupError('Passwords do not match.');
      return;
    }
    if (signupPassword.length < 6) {
      setSignupError('Password must be at least 6 characters.');
      return;
    }
    setIsSubmitting(true);
    const { error, needsVerification } = await signUp(signupEmail, signupPassword, signupName);
    setIsSubmitting(false);
    if (error) {
      setSignupError(error);
      return;
    }
    if (needsVerification) {
      setSuccessMessage(`Account created! Check your inbox at ${signupEmail} to verify your account, then log in.`);
      setActiveTab('login');
    } else {
      navigate('/dashboard');
    }
  };

  const handleForgotPassword = async () => {
    if (!loginEmail) {
      setLoginError('Enter your email address above, then click Forgot Password.');
      return;
    }
    setIsSubmitting(true);
    const { error } = await resetPassword(loginEmail);
    setIsSubmitting(false);
    if (error) {
      setLoginError(error);
    } else {
      setSuccessMessage(`Password reset link sent to ${loginEmail}. Check your inbox.`);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#FF6B35] animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col relative overflow-hidden font-sans">
      {/* Background Decorative Elements */}
      <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-[#FF6B35]/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] rounded-full bg-indigo-500/5 blur-[100px] pointer-events-none" />
      
      {/* Grid Pattern overlay */}
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 max-w-7xl mx-auto w-full px-6 py-6 flex items-center justify-between">
        <HeaderBranding />
        
        <div>
          <button 
            onClick={() => {
              setActiveTab('login');
              document.getElementById('auth-section')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="px-4 py-2 text-sm font-semibold text-slate-700 hover:text-slate-900 transition-all cursor-pointer"
          >
            Log In
          </button>
          <button 
            onClick={() => {
              setActiveTab('signup');
              document.getElementById('auth-section')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="ml-3 px-4 py-2 text-sm font-semibold bg-[#FF6B35] hover:bg-[#ff804d] text-slate-900 rounded-xl transition-all shadow-[0_4px_20px_rgba(255,107,53,0.3)] cursor-pointer"
          >
            Sign Up
          </button>
        </div>
      </header>

      {/* Hero & Auth Panel Split */}
      <main className="relative z-10 flex-1 max-w-7xl mx-auto w-full px-6 flex flex-col lg:flex-row items-center justify-between gap-12 py-12 lg:py-20">
        
        {/* Left Side: Tagline and features */}
        <div className="flex-1 space-y-6 lg:max-w-xl text-center lg:text-left">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#FF6B35]/10 rounded-full border border-[#FF6B35]/20 text-[#FF6B35] text-xs font-semibold uppercase tracking-wider mb-2">
            <Zap className="w-3.5 h-3.5 fill-current" /> Design, Simulate, Innovate
          </div>
          
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900 leading-tight">
            Create Electronics <br className="hidden sm:inline" />
            Without <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#FF6B35] to-orange-400">Limits</span>.
          </h1>
          
          <p className="text-slate-600 text-base sm:text-lg leading-relaxed">
            Build, simulate, and debug interactive microcontrollers and sensors directly in your web browser. Write real code, visualize signals, and bring your ideas to life.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4 pt-4">
            <button
              onClick={() => {
                setActiveTab('signup');
                document.getElementById('auth-section')?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="w-full sm:w-auto px-8 py-3.5 bg-[#FF6B35] hover:bg-[#ff804d] text-slate-900 font-bold rounded-xl transition-all shadow-[0_4px_20px_rgba(255,107,53,0.3)] text-sm cursor-pointer"
            >
              Sign Up Free
            </button>
            <button
              onClick={() => {
                setActiveTab('login');
                document.getElementById('auth-section')?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="w-full sm:w-auto px-8 py-3.5 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 font-bold rounded-xl transition-all text-sm cursor-pointer"
            >
              Log In to Dashboard
            </button>
          </div>

          {/* Micro Stats */}
          <div className="grid grid-cols-3 gap-6 pt-10 border-t border-slate-300/60 max-w-md mx-auto lg:mx-0">
            <div>
              <div className="text-2xl font-bold text-slate-900">100%</div>
              <div className="text-xs text-slate-500">Virtual Simulation</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900">15+</div>
              <div className="text-xs text-slate-500">Pre-built Parts</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900">C++/Python</div>
              <div className="text-xs text-slate-500">Dual Programming</div>
            </div>
          </div>
        </div>

        {/* Right Side: Auth Forms Box */}
        <div id="auth-section" className="w-full max-w-md bg-white/70 border border-slate-300/80 backdrop-blur-md p-8 rounded-3xl shadow-2xl flex flex-col transition-all duration-300">
          
          {/* Global Success Banner */}
          {successMessage && (
            <div className="mb-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 p-3 rounded-xl flex items-start gap-2 text-xs">
              <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Tab switches */}
          <div className="flex bg-slate-100/45 p-1 rounded-2xl border border-slate-300 mb-6">
            <button
              onClick={() => {
                setActiveTab('login');
                setLoginError('');
                setSignupError('');
                setSuccessMessage('');
              }}
              className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                activeTab === 'login'
                  ? 'bg-[#FF6B35] text-slate-900 shadow-md'
                  : 'text-slate-600 hover:text-slate-800'
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => {
                setActiveTab('signup');
                setLoginError('');
                setSignupError('');
                setSuccessMessage('');
              }}
              className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                activeTab === 'signup'
                  ? 'bg-[#FF6B35] text-slate-900 shadow-md'
                  : 'text-slate-600 hover:text-slate-800'
              }`}
            >
              Create Account
            </button>
          </div>

          {/* Form Content */}
          {activeTab === 'login' ? (
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900 mb-1">Welcome back!</h2>
                <p className="text-xs text-slate-600 mb-4">Log in to continue building your circuit designs.</p>
              </div>

              {loginError && (
                <div className="bg-rose-500/10 border border-rose-500/20 text-rose-600 p-3 rounded-xl flex items-center gap-2 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{loginError}</span>
                </div>
              )}

              <div className="space-y-3.5">
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3.5" />
                  <input
                    type="email"
                    placeholder="Email Address"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl py-3 pl-10 pr-4 text-xs text-slate-800 focus:outline-none focus:border-[#FF6B35] transition-colors"
                  />
                </div>

                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3.5" />
                  <input
                    type="password"
                    placeholder="Password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl py-3 pl-10 pr-4 text-xs text-slate-800 focus:outline-none focus:border-[#FF6B35] transition-colors"
                  />
                </div>
              </div>

              <div className="flex justify-between items-center text-[11px] pt-1">
                <label className="flex items-center gap-1.5 text-slate-600 cursor-pointer">
                  <input type="checkbox" className="rounded border-slate-300 bg-slate-50 text-[#FF6B35] focus:ring-[#FF6B35]" />
                  Remember me
                </label>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="text-[#FF6B35] hover:underline font-semibold cursor-pointer"
                >
                  Forgot Password?
                </button>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 bg-[#FF6B35] hover:bg-[#ff804d] disabled:opacity-60 text-slate-900 font-bold rounded-xl text-xs transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
              >
                {isSubmitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing In...</> : 'Log In'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSignupSubmit} className="space-y-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900 mb-1">Get Started Free</h2>
                <p className="text-xs text-slate-600 mb-4">No credit card required. Create circuits in seconds.</p>
              </div>

              {signupError && (
                <div className="bg-rose-500/10 border border-rose-500/20 text-rose-600 p-3 rounded-xl flex items-center gap-2 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{signupError}</span>
                </div>
              )}

              <div className="space-y-3">
                <div className="relative">
                  <User className="w-4 h-4 text-slate-500 absolute left-3 top-3.5" />
                  <input
                    type="text"
                    placeholder="Full Name"
                    value={signupName}
                    onChange={(e) => setSignupName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl py-3 pl-10 pr-4 text-xs text-slate-800 focus:outline-none focus:border-[#FF6B35] transition-colors"
                  />
                </div>

                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3.5" />
                  <input
                    type="email"
                    placeholder="Email Address"
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl py-3 pl-10 pr-4 text-xs text-slate-800 focus:outline-none focus:border-[#FF6B35] transition-colors"
                  />
                </div>

                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3.5" />
                  <input
                    type="password"
                    placeholder="Create Password"
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl py-3 pl-10 pr-4 text-xs text-slate-800 focus:outline-none focus:border-[#FF6B35] transition-colors"
                  />
                </div>

                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3.5" />
                  <input
                    type="password"
                    placeholder="Confirm Password"
                    value={signupConfirm}
                    onChange={(e) => setSignupConfirm(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl py-3 pl-10 pr-4 text-xs text-slate-800 focus:outline-none focus:border-[#FF6B35] transition-colors"
                  />
                </div>
              </div>

              <div className="text-[10px] text-slate-500 text-center leading-normal">
                By signing up, you agree to our Terms of Service <br />
                and Privacy Policy.
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 bg-[#FF6B35] hover:bg-[#ff804d] disabled:opacity-60 text-slate-900 font-bold rounded-xl text-xs transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
              >
                {isSubmitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating Account...</> : 'Sign Up Free'}
              </button>
            </form>
          )}

        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-6 border-t border-slate-300/60 bg-white/20 text-center text-xs text-slate-500 mt-auto">
        &copy; {new Date().getFullYear()} DSULab. Designed for virtual physics and engineering labs.
      </footer>
    </div>
  );
};
