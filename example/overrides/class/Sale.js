var util    = require('util'),
    Base    = require('./../../../lib/Base');

// In real-world usage you would require like this:
// var Base = require('nordis').Base;

function Sale(hOpts,fnCallback) {
    Sale.super_.call(this,hOpts,fnCallback);
}
util.inherits(Sale,Base);
var p = Sale.prototype;

// Now you can override any Base methods (save, delete, etc) or create your own class-specific methods.
// In this example, I'm just going to tack something onto the object for my unit test to confirm.
p.save = function(hOpts,fnCallback) {
    var oSelf = this;

    if (hOpts instanceof Function) {
        fnCallback = hOpts;
        hOpts = undefined;
    }

    p.save.super_.call(oSelf,hOpts,function(err){
        oSelf.bOverridden = true;
        fnCallback(err,oSelf);
    });
};
util.inherits(p.save,Base.prototype.save);

module.exports = Sale;