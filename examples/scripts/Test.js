var validator   = require('validator');

var value = '1.1';

console.log(validator.isInt(value));
console.log(parseInt(value));
console.log(validator.isFloat(value));
console.log(parseFloat(value));
