// Phone baseline for the admin pages that apply it to their root: no grey tap
// flash, and form fields at 16px on touch screens so iOS Safari doesn't zoom
// in on focus. Desktop keeps each field's own size. Safe to drop once the same
// rules live globally in index.css.
export const touchBaseline = '[-webkit-tap-highlight-color:transparent] [@media(pointer:coarse)]:[&_:is(input,select,textarea)]:text-base'
