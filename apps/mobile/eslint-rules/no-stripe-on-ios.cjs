// no-stripe-on-ios — forbid Stripe references in iOS-conditional code paths.
// Canon §F8.16: the iOS bundle MUST NOT reference Stripe checkout surfaces.
//
// Fires when any of these tokens appear inside apps/mobile/src/**/*.{ts,tsx}
// UNLESS the nearest enclosing Platform.OS check is `Platform.OS !== 'ios'`
// (i.e. an Android-only guard).
//
// Forbidden tokens:
//   - 'stripe://' (URL scheme literal)
//   - 'checkout.stripe.com' (literal)
//   - 'STRIPE_PUBLISHABLE_KEY' (env var reference)
//   - 'EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY' (env var reference)
//
// This rule runs as a string-scan on Literal nodes. A future version could
// add MemberExpression awareness; this is sufficient for App Review compliance.

'use strict';

const FORBIDDEN_TOKENS = [
  'stripe://',
  'checkout.stripe.com',
  'STRIPE_PUBLISHABLE_KEY',
  'EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY',
];

function isPlatformOsMember(node) {
  return (
    node &&
    node.type === 'MemberExpression' &&
    node.object &&
    node.object.type === 'Identifier' &&
    node.object.name === 'Platform' &&
    node.property &&
    node.property.type === 'Identifier' &&
    node.property.name === 'OS'
  );
}

/** True for `Platform.OS !== 'ios'` or `Platform.OS === 'android'`. */
function isAndroidGuardExpression(node) {
  if (!node || node.type !== 'BinaryExpression') return false;
  if (
    node.operator === '!==' &&
    isPlatformOsMember(node.left) &&
    node.right &&
    node.right.type === 'Literal' &&
    node.right.value === 'ios'
  ) {
    return true;
  }
  if (
    node.operator === '===' &&
    isPlatformOsMember(node.left) &&
    node.right &&
    node.right.type === 'Literal' &&
    node.right.value === 'android'
  ) {
    return true;
  }
  return false;
}

/**
 * Walk up the ancestor chain and return true if the node sits in a code path
 * that is statically guarded as Android-only:
 *   - `cond ? <here> : ...`        when cond === Android guard
 *   - `cond && <here>`             when cond === Android guard
 *   - `if (cond) { <here> }`       when cond === Android guard
 * Returns false in all other contexts.
 */
function isInsideAndroidGuard(node, ancestors) {
  // Append the node itself so we can compare child relationships.
  const chain = [...ancestors, node];
  for (let i = chain.length - 1; i > 0; i--) {
    const cur = chain[i];
    const parent = chain[i - 1];
    if (!parent) continue;
    // ConditionalExpression: only the consequent is the guarded branch.
    if (parent.type === 'ConditionalExpression' && parent.consequent === cur) {
      if (isAndroidGuardExpression(parent.test)) return true;
    }
    // LogicalExpression: `guard && body` — body is the right side.
    if (
      parent.type === 'LogicalExpression' &&
      parent.operator === '&&' &&
      parent.right === cur
    ) {
      if (isAndroidGuardExpression(parent.left)) return true;
    }
    // IfStatement: only the consequent (true branch) is guarded.
    if (parent.type === 'IfStatement' && parent.consequent === cur) {
      if (isAndroidGuardExpression(parent.test)) return true;
    }
  }
  return false;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid Stripe references in iOS-conditional code (App Review compliance, canon §F8.16)',
      category: 'Security',
      recommended: true,
    },
    schema: [],
    messages: {
      noStripeOnIos:
        "Stripe token '{{token}}' must not appear in iOS code paths (canon §F8.16). " +
        "Wrap it in a Platform.OS !== 'ios' guard or move it to the Android branch.",
    },
  },
  create(context) {
    // ESLint v9: context.sourceCode.getAncestors(node) is preferred.
    // ESLint v8 fallback: context.getAncestors().
    const getAncestors = (node) => {
      if (context.sourceCode && typeof context.sourceCode.getAncestors === 'function') {
        return context.sourceCode.getAncestors(node);
      }
      if (typeof context.getAncestors === 'function') {
        return context.getAncestors();
      }
      return [];
    };
    return {
      Literal(node) {
        if (typeof node.value !== 'string') return;
        const val = node.value;
        for (const token of FORBIDDEN_TOKENS) {
          if (val.includes(token)) {
            const ancestors = getAncestors(node);
            if (!isInsideAndroidGuard(node, ancestors)) {
              context.report({
                node,
                messageId: 'noStripeOnIos',
                data: { token },
              });
            }
          }
        }
      },
    };
  },
};
