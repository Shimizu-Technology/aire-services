import '@testing-library/jest-dom'

// Happy DOM 21 exposes Web Animations, but there is no browser compositor in
// these component tests. Motion's native path leaves rejected `finished`
// promises when RTL unmounts an animating element. Keep its JS fallback (as in
// the previous test environment); real animation behavior belongs in browser QA.
Reflect.deleteProperty(Element.prototype, 'animate')
