// Inherit the StandardJS style from `prettier-config-standard`, then override
// `printWidth` to 100 so Prettier and `eslint-config-standard` (which defaults
// to 100) agree on line wrapping and stop reformatting each other's output.
module.exports = {
  ...require('prettier-config-standard'),
  printWidth: 100
}
