// Accuracy fixtures: React render vs event handlers. Every mark is hand-written; scripts/accuracy/README.md
// explains them. Each scenario is one click on the named button, after the page loaded and rendered once,
// so the first render is not part of any click. No StrictMode: it renders twice on purpose in development.
// Line numbers are the test: don't reformat.
import { memo, useEffect, useState } from 'react';
import { PressButton, SocketButton, WorkerButton } from './limits.jsx';

// @scenario react-handler-only
// @click Log only
// @fn onLog 1
export function LogButton() { //! 0
  const onLog = () => { //! 1
    window.__logged = (window.__logged ?? 0) + 1; //! 1
  }; //! ?
  return <button type="button" onClick={onLog}>Log only</button>; //! 0
} //! ?

// @scenario react-state-render
// @click Add one
// @fn Counter 1
// @fn increment 1
export function Counter() { //! 1
  const [n, setN] = useState(0); //! 1
  const increment = () => { //! 1
    setN(n + 1); //! 1
  }; //! ?
  const parity = n % 2 === 0 ? 'even' : 'odd'; //! 1 span:'even'
  return <button type="button" onClick={increment}>Add one ({n}, {parity})</button>; //! 1
} //! ?

// @scenario react-memo
// @click Rename
// @fn Plain 1
// @fn Parent 1
// @fn rename 1
function Plain({ name }) { //! 1
  return <span>plain {name}</span>; //! 1
} //! ?
const Fancy = memo(function Fancy({ label }) { //! 0
  return <span>fancy {label}</span>; //! 0
}); //! ?
export function Parent() { //! 1
  const [name, setName] = useState('a'); //! 1
  const rename = () => { //! 1
    setName(`${name}a`); //! 1
  }; //! ?
  return <div><button type="button" onClick={rename}>Rename</button><Plain name={name} /><Fancy label="fixed" /></div>; //! 1
} //! ?

// @scenario react-inline-handler
// @click Toggle
// @fn Toggle 1
// @fn (anonymous) 1
export function Toggle() { //! 1
  const [open, setOpen] = useState(false); //! 1
  return <button type="button" onClick={() => setOpen(!open)}>Toggle {open ? 'open' : 'closed'}</button>; //! 1 span:'closed'
} //! ?

// @scenario react-effect
// @click Bump
// @fn Effects 1
// @fn (anonymous) 1
// @fn (anonymous) 1
// @fn bump 1
export function Effects() { //! 1
  const [v, setV] = useState(0); //! 1
  useEffect(() => { //! 1
    document.title = `bumped ${v}`; //! 1
    return () => { //! 1
      window.__cleanups = (window.__cleanups ?? 0) + 1; //! 1
    }; //! ?
  }, [v]); //! 1
  const bump = () => { //! 1
    setV(v + 1); //! 1
  }; //! ?
  return <button type="button" onClick={bump}>Bump {v}</button>; //! 1
} //! ?
// @end

export function App() {
  return (
    <main>
      <LogButton />
      <Counter />
      <Parent />
      <Toggle />
      <Effects />
      <WorkerButton />
      <SocketButton />
      <PressButton />
    </main>
  );
}
