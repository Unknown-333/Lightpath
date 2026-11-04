// Entry of the accuracy audit's React app (no StrictMode, see src/App.jsx).
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';

createRoot(document.getElementById('root')).render(<App />);
