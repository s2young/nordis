var async       = require('async'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    AppConfig         = require('./../lib/AppConfig');

module.exports = {
    setUp:function(callback) {
        var self = this;

        async.series([
            function(cb) {
                self.user = Base.lookup({sClass:'User'});
                self.user.set('name','TestUser');
                self.user.set('email','test@test.com');
                self.user.save(cb);
            }
            ,function(cb){
                // Create but don't save the follower object.
                self.follower = Base.lookup({sClass:'User'});
                self.follower.set('name','TestUser\'s Follower');
                self.follower.set('email','follower@test.com');
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
                self.follower.delete(cb);
            }
        ],callback);
    }
    ,saveReferringUser:function(test) {
        var self = this;
        test.expect(1);
        async.series([
            function(callback) {
                // This will both save the follower and set the user.referrer_id
                self.user.setExtra('referring_user',self.follower,callback);
            }
            ,function(callback) {
                test.equal(self.user.get('referrer_id'),self.follower.getKey());
                callback();
            }
        ],function(err){ AppConfig.wrapTest(err,test); })
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
                hQuery[AppConfig.hClasses.User.sKeyProperty] = self.user.getKey();
                Base.lookup({
                    sClass:'User'
                    ,hQuery:hQuery
                },callback);
            }
            ,function(user,callback){
                AppConfig.log(user.sSource+' lookup time for primary key lookup of user only: '+(new Date().getTime()-nStart)+' ms');
                test.equal(user.getKey(),self.user.getKey());
                callback();
            }
        ],function(err){ AppConfig.wrapTest(err,test); });
    }
    ,lookupUserAndExtras:function(test){
        var self = this;
        test.expect(4);
        var nStart;
        async.waterfall([
            function(callback) {
                // This will both save the follower and set the user.referrer_id
                self.user.setExtra('referring_user',self.follower,callback);
            }
            ,function(user,callback) {
                test.equal(self.user.get('referrer_id'),self.follower.getKey());
                nStart = new Date().getTime();

                var hQuery = {};
                hQuery[self.user.getSettings().sKeyProperty] = self.user.getKey();

                Base.lookup({
                    sClass:'User'
                    ,hQuery:hQuery
                    ,hExtras:{referring_user:true}
                },callback);
            }
            ,function(user,callback){
                AppConfig.log(user.sSource+' lookup time for primary key lookup of user + one object extra: '+(new Date().getTime()-nStart)+' ms');
                test.equal(user.getKey(),self.user.getKey());
                test.equal(user.referring_user.getKey(),self.user.get('referrer_id')); // Unless you also change the aKey settings for this relationship, changing the primary key for giggles could break this one.
                test.equal(user.sSource,'Redis');
                callback();
            }
        ],function(err){ AppConfig.wrapTest(err,test); });
    }
    ,deleteReferringUser:function(test){
        // What if the referring user is removed?  The references to it in the referred user should also be removed.
        var self = this;
        test.expect(3);
        async.waterfall([
            function(callback) {
                // Add the follower as the referring user.
                self.user.setExtra('referring_user',self.follower,callback);
            }
            ,function(user,callback) {
                test.equal(self.user.get('referrer_id'),self.follower.getKey());
                // Now, delete the follower.
                self.follower.delete(callback);
            }
            ,function(user,callback){
                // Now, try and lookup the follower (follower) via the referred user (user).
                var hQuery = {};
                hQuery[self.user.getSettings().sKeyProperty] = self.user.getKey();
                Base.lookup({
                    sClass:'User'
                    ,hQuery:hQuery
                    ,hExtras:{referring_user:true}
                },callback);
            }
            ,function(user,callback){
                test.equal(user.getKey(),self.user.getKey());
                test.equal(user.referring_user.getKey(),null);
                callback();
            }
        ],function(err){ AppConfig.wrapTest(err,test); });
    }
    ,lookupUserViaMySqlOnly:function(test){
        var self = this;
        // Here is how to look up a user and specify that the data come only from MySql.
        test.expect(2);

        var nStart= new Date().getTime();
        var hQuery = {};
        hQuery[AppConfig.hClasses.User.sKeyProperty] = self.user.getKey();

        Base.lookup({sClass:'User',hQuery:hQuery,sSource:'MySql'},function(err,user){
            AppConfig.log(user.sSource+' lookup time for primary key lookup of user only: '+(new Date().getTime()-nStart)+' ms');
            test.equal(user.sSource,'MySql');
            test.equal(user.getKey(),self.user.getKey());
            AppConfig.wrapTest(err,test);
        });
    }
};