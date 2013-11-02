var async       = require('async'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    App         = require('./../lib/AppConfig');

var nTestSize = 1000;
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
            var nTotalTime = (new Date().getTime() - nStart);
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
    ,setStringExtra:function(test){
        var oSelf = this;
        test.expect(1);

        var nStart = new Date().getTime();
        var setStuff = function(n,cb) {
            oSelf.oUser.setExtra('sBlob','This is whatever it needs to be. Something serialized?',function(err){
                cb(err);
            });
        };
        var q = async.queue(setStuff,1);
        q.drain = function(err){
            var nTotalTime = (new Date().getTime() - nStart);
            oSelf.oUser.loadExtras({sBlob:true},function(err){
                test.equal(oSelf.oUser.sBlob,'This is whatever it needs to be. Something serialized?');
                console.log('Total time (Redis): '+nTotalTime+': '+(nTotalTime/nTestSize)+' ms per string set;\n');
                App.wrapTest(err,test);
            });
        };

        for (var n = 0; n < nTestSize; n++) {
            q.push(n);
        }
    }
    ,setNumberExtra:function(test){
        var oSelf = this;
        test.expect(1);

        var nStart = new Date().getTime();
        var setStuff = function(n,cb) {
            oSelf.oUser.setExtra('nStatic',1000,function(err){
               cb(err);
            });
        };
        var q = async.queue(setStuff,1);
        q.drain = function(err){
            var nTotalTime = (new Date().getTime() - nStart);
            oSelf.oUser.loadExtras({nStatic:true},function(err){
                test.equal(oSelf.oUser.nStatic,1000);
                console.log('Total time (Redis): '+nTotalTime+': '+(nTotalTime/nTestSize)+' ms per static number set;\n');
                App.wrapTest(err,test);
            });
        };

        for (var n = 0; n < nTestSize; n++) {
            q.push(n);
        }
    }
    ,trackIncrementStringAndNumber:function(test){
        var oSelf = this;
        test.expect(3);

        var nStart = new Date().getTime();
        var setStuff = function(n,cb) {
            async.series([
                function(callback) {
                    oSelf.oUser.setExtra('nStatic',1000,callback);
                }
                ,function(callback) {
                    oSelf.oUser.setExtra('sBlob','This is whatever it needs to be. Something serialized?',callback);
                }
                ,function(callback) {
                    oSelf.oUser.setExtra('nPoints',1,callback);
                }
            ],cb);
        };
        var q = async.queue(setStuff,1);
        q.drain = function(err){
            var nTotalTime = (new Date().getTime() - nStart);
            nStart = new Date().getTime();
            oSelf.oUser.loadExtras({nStatic:true,sBlob:true,nPoints:true},function(err){
                test.equal(oSelf.oUser.nStatic,1000);
                test.equal(oSelf.oUser.sBlob,'This is whatever it needs to be. Something serialized?');
                test.equal(oSelf.oUser.nPoints,nTestSize);

                console.log('Total time (Redis): '+nTotalTime+': '+(nTotalTime/nTestSize)+' ms per record to set: String, Number & Increment;\n');
                console.log('Lookup time for all four extras: '+(new Date().getTime()-nStart)+' ms\n');
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
        Base.lookup({
            sClass:'User'
            ,hQuery:{nID:oSelf.oUser.get('nID')}
            ,hExtras:{nStatic:true,sBlob:true,nPoints:true}
        },function(err,oUser){
            console.log('Lookup time for primary key lookup of user + three static extras + one object extra: '+(new Date().getTime()-nStart)+' ms');
            test.equal(oUser.get('nID'),oSelf.oUser.get('nID'));

            App.wrapTest(err,test);
        });
    }
};