import { describe, expect, it } from 'vitest';
import { actionabilityProblem, describeTarget, parseTarget, signInHint, similarity } from '../src/target.js';

describe('parseTarget (design section 4.1)', () => {
  it.each([
    ['css=button.primary', { kind: 'css', selector: 'button.primary' }],
    ['css= li:nth-child(2) button ', { kind: 'css', selector: 'li:nth-child(2) button' }],
    ['button "Checkout"', { kind: 'role', role: 'button', name: 'Checkout' }],
    ['link "Next page"', { kind: 'role', role: 'link', name: 'Next page' }],
    ['textbox "Coupon (try WELCOME10)"', { kind: 'role', role: 'textbox', name: 'Coupon (try WELCOME10)' }],
    ['menuitem "Say "hi""', { kind: 'role', role: 'menuitem', name: 'Say "hi"' }],
    // Not an ARIA role, so the whole thing is text.
    ['buttons "Checkout"', { kind: 'text', text: 'buttons "Checkout"' }],
    ['Button "Checkout"', { kind: 'text', text: 'Button "Checkout"' }],
    ['button Checkout', { kind: 'text', text: 'button Checkout' }],
    ['Checkout', { kind: 'text', text: 'Checkout' }],
    ['  Add to cart  ', { kind: 'text', text: 'Add to cart' }],
  ])('%s', (input, parsed) => {
    expect(parseTarget(input)).toEqual(parsed);
  });

  it('names within in messages', () => {
    expect(describeTarget('button "Add to cart"', 'Coffee mug')).toBe(
      'button "Add to cart" within "Coffee mug"',
    );
    expect(describeTarget('Checkout')).toBe('Checkout');
  });
});

describe('actionabilityProblem (outcome mapping)', () => {
  it.each([
    ['<div class="overlay"></div> intercepts pointer events', 'covered by another element'],
    ['element is not visible', 'hidden'],
    ['element is not enabled', 'disabled'],
    ['element is not editable', 'not editable'],
    ['element is not stable', 'still moving'],
    ['Element is outside of the viewport', 'outside the page'],
    ['Timeout 2000ms exceeded.', undefined],
  ])('%s', (message, reason) => {
    expect(actionabilityProblem(message)).toBe(reason);
  });
});

describe('similarity (not_found candidates)', () => {
  it('ranks a typo above an unrelated name', () => {
    expect(similarity('Chekout', 'Checkout')).toBeGreaterThan(similarity('Chekout', 'Add to cart'));
    expect(similarity('cart', 'Add to cart')).toBe(1);
    expect(similarity('', 'x')).toBe(0);
  });
});

describe('signInHint (not_found on a sign-in page, D-139)', () => {
  it('says what the page is and gives a run_action call built from its fields', () => {
    const hint = signInHint({
      fields: [
        { target: 'textbox "Email"', label: 'email' },
        { target: 'textbox "Password"', label: 'password' },
      ],
      submit: 'button "Login"',
    });
    expect(hint).toBe(
      [
        'This page is a sign-in form (it has a password field), so the app is not signed in here. Sign in first with its own fields, putting the real values in place of the <...> ones, then do your step again:',
        '  run_action {"target":"button \\"Login\\"","fill":[{"target":"textbox \\"Email\\"","value":"<email>"},{"target":"textbox \\"Password\\"","value":"<password>"}]}',
      ].join('\n'),
    );
    // The call is valid run_action input.
    const call = JSON.parse(hint.split('run_action ')[1] ?? '');
    expect(call.target).toBe('button "Login"');
    expect(call.fill).toHaveLength(2);
  });

  it('presses Enter in the last field when the form has no submit button', () => {
    const hint = signInHint({ fields: [{ target: 'css=input[type="password"]', label: 'password' }] });
    const call = JSON.parse(hint.split('run_action ')[1] ?? '');
    expect(call).toEqual({
      target: 'css=input[type="password"]',
      action: 'press',
      fill: [{ target: 'css=input[type="password"]', value: '<password>' }],
    });
  });
});
