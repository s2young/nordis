var async       = require('async'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    App         = require('./../lib/AppConfig');

var nTestSize = 10;

module.exports = {
    setUp:function(callback) {
        var self = this;
        self.user = Base.lookup({sClass:'User'});
        self.user.set('name','TestUser');
        self.user.set('email','test@test.com');
        self.user.save(null,callback);
    }
    ,tearDown:function(callback) {
        var self = this;
        self.user.delete(callback);
    }
    ,trackPoints:function(test){
        var self = this;
        test.expect(1);

        var nStart = new Date().getTime();
        var setStuff = function(n,cb) {
            self.user.setExtra('points',1,function(err){
                cb(err);
            });
        };
        var q = async.queue(setStuff,1);
        q.drain = function(){
            var nTotalTime = (new Date().getTime() - nStart);
            self.user.loadExtras({points:true},function(err){
                test.equal(self.user.points,nTestSize);
                App.log('Total time (Redis): '+nTotalTime+': '+(nTotalTime/nTestSize)+' ms per increment;');
                App.wrapTest(err,test);
            });
        };

        for (var n = 0; n < nTestSize; n++) {
            q.push(n);
        }
    }
    ,lookupUserAndExtras:function(test){
        var self = this;
        test.expect(1);

        var nStart = new Date().getTime();
        // Lookup user by primary key (nID) and request some extras.
        var hQuery = {};
        hQuery[App.hClasses.User.sNumKeyProperty] = self.user.getNumKey();
        Base.lookup({
            sClass:'User'
            ,hQuery:hQuery
            ,hExtras:{points:true}
        },function(err,user){
            App.log('Lookup time for primary key lookup of user + three static extras + one object extra: '+(new Date().getTime()-nStart)+' ms');
            test.equal(user.getNumKey(),self.user.getNumKey());

            App.wrapTest(err,test);
        });
    }
};