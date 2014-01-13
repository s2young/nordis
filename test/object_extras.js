var async       = require('async'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    App         = require('./../lib/AppConfig');

module.exports = {
    setUp:function(callback) {
        var self = this;

        async.series([
            function(cb) {
                self.user = Base.lookup({sClass:'User'});
                self.user.set('name','TestUser');
                self.user.set('email','test@test.com');
                self.user.save(null,cb);
            }
            ,function(cb){
                // Create but don't save the friend object.
                self.friend = Base.lookup({sClass:'User'});
                self.friend.set('name','TestUser\'s Friend');
                self.friend.set('email','friend@test.com');
                cb();
            }
        ],callback);
    }
    ,tearDown:function(callback) {
        var self = this;
        async.parallel([
            function(cb){
                self.user.delete(cb);
            }
            ,function(cb){
                self.friend.delete(cb);
            }
        ],callback);
    }
    ,saveReferringUser:function(test) {
        var self = this;
        test.expect(1);
        async.series([
            function(callback) {
                // This will both save the friend and set the user.referrer_id
                self.user.setExtra('referring_user',self.friend,callback);
            }
            ,function(callback) {
                test.equal(self.user.get('referrer_id'),self.friend.getNumKey());
                callback();
            }
        ],function(err){ App.wrapTest(err,test); })
    }
    ,lookupUserOnly:function(test){
        var self = this;
        test.expect(1);
        var nStart;
        async.waterfall([
            function(callback) {
                nStart = new Date().getTime();
                // Lookup user by primary, numeric key and request some extras.
                var hQuery = {};
                hQuery[App.hClasses.User.sNumKeyProperty] = self.user.getNumKey();
                Base.lookup({
                    sClass:'User'
                    ,hQuery:hQuery
                },callback);
            }
            ,function(user,callback){
                App.log(user.sSource+' lookup time for primary key lookup of user only: '+(new Date().getTime()-nStart)+' ms');
                test.equal(user.getNumKey(),self.user.getNumKey());
                callback();
            }
        ],function(err){ App.wrapTest(err,test); });
    }
    ,lookupUserAndExtras:function(test){
        var self = this;
        test.expect(4);
        var nStart;
        async.waterfall([
            function(callback) {
                // This will both save the friend and set the user.referrer_id
                self.user.setExtra('referring_user',self.friend,callback);
            }
            ,function(user,callback) {
                test.equal(self.user.get('referrer_id'),self.friend.getNumKey());
                nStart = new Date().getTime();

                var hQuery = {};
                hQuery[self.user.getSettings().sNumKeyProperty] = self.user.getNumKey();

                Base.lookup({
                    sClass:'User'
                    ,hQuery:hQuery
                    ,hExtras:{referring_user:true}
                },callback);
            }
            ,function(user,callback){
                App.log(user.sSource+' lookup time for primary key lookup of user + one object extra: '+(new Date().getTime()-nStart)+' ms');
                test.equal(user.getNumKey(),self.user.getNumKey());
                test.equal(user.referring_user.getNumKey(),self.user.get('referrer_id')); // Unless you also change the aKey settings for this relationship, changing the primary key for giggles could break this one.
                test.equal(user.sSource,'Redis');
                callback();
            }
        ],function(err){ App.wrapTest(err,test); });
    }
    ,deleteReferringUser:function(test){
        // What if the referring user is removed?  The references to it in the referred user should also be removed.
        var self = this;
        test.expect(3);
        async.waterfall([
            function(callback) {
                // Add the friend as the referring user.
                self.user.setExtra('referring_user',self.friend,callback);
            }
            ,function(user,callback) {
                test.equal(self.user.get('referrer_id'),self.friend.getNumKey());
                // Now, delete the friend.
                self.friend.delete(callback);
            }
            ,function(user,callback){
                // Now, try and lookup the friend (friend) via the referred user (user).
                var hQuery = {};
                hQuery[self.user.getSettings().sNumKeyProperty] = self.user.getNumKey();
                Base.lookup({
                    sClass:'User'
                    ,hQuery:hQuery
                    ,hExtras:{referring_user:true}
                },callback);
            }
            ,function(user,callback){
                test.equal(user.getNumKey(),self.user.getNumKey());
                test.equal(user.referring_user.getNumKey(),null);
                callback();
            }
        ],function(err){ App.wrapTest(err,test); });
    }
    ,lookupUserViaMySqlOnly:function(test){
        var self = this;
        // Here is how to look up a user and specify that the data come only from MySql.
        test.expect(2);

        var nStart= new Date().getTime();
        var hQuery = {};
        hQuery[App.hClasses.User.sNumKeyProperty] = self.user.getNumKey();

        Base.lookup({sClass:'User',hQuery:hQuery,sSource:'MySql'},function(err,user){
            App.log(user.sSource+' lookup time for primary key lookup of user only: '+(new Date().getTime()-nStart)+' ms');
            test.equal(user.sSource,'MySql');
            test.equal(user.getNumKey(),self.user.getNumKey());
            App.wrapTest(err,test);
        });
    }
};