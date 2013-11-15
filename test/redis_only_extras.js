var async       = require('async'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    App         = require('./../lib/AppConfig');

var nTestSize = 10;

module.exports = {
    setUp:function(callback) {
        var oSelf = this;
        // Create empty Base object of class 'User.'
        async.series([
            function(cb) {
                oSelf.oUser = Base.lookup({sClass:'User'});
                oSelf.oUser.set('sName','TestUser');
                oSelf.oUser.set('sEmail','test@test.com');
                oSelf.oUser.save(null,cb);
            }
        ],callback);
    }
    ,tearDown:function(callback) {
        var oSelf = this;

        async.parallel([
            function(cb){
                oSelf.oUser.delete(cb);
            }
        ],callback);
    }
    ,trackPoints:function(test){
        var oSelf = this;
        test.expect(1);

        var nStart = new Date().getTime();
        var setStuff = function(n,cb) {
            oSelf.oUser.setExtra('nPoints',1,function(err){
                cb(err);
            });
        };
        var q = async.queue(setStuff,1);
        q.drain = function(err){
            var nTotalTime = (new Date().getTime() - nStart);3
            oSelf.oUser.loadExtras({nPoints:true},function(err){
                test.equal(oSelf.oUser.nPoints,nTestSize);
                console.log('Total time (Redis): '+nTotalTime+': '+(nTotalTime/nTestSize)+' ms per increment;\n');
                App.wrapTest(err,test);
            });
        };

        for (var n = 0; n < nTestSize; n++) {
            q.push(n);
        }
    }
    ,lookupUserAndExtras:function(test){
        var oSelf = this;
        test.expect(1);

        var nStart = new Date().getTime();
        // Lookup user by primary key (nID) and request some extras.
        var hQuery = {};
        hQuery[App.hClasses.User.sNumericKey] = oSelf.oUser.getNumKey();
        Base.lookup({
            sClass:'User'
            ,hQuery:hQuery
            ,hExtras:{nPoints:true}
        },function(err,oUser){
            console.log('Lookup time for primary key lookup of user + three static extras + one object extra: '+(new Date().getTime()-nStart)+' ms');
            test.equal(oUser.getNumKey(),oSelf.oUser.getNumKey());

            App.wrapTest(err,test);
        });
    }
};