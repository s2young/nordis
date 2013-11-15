var async       = require('async'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    App         = require('./../lib/AppConfig');

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
            ,function(cb){
                // Create but don't save the friend object.
                oSelf.oFriend = Base.lookup({sClass:'User'});
                oSelf.oFriend.set('sName','TestUser\'s Friend');
                oSelf.oFriend.set('sEmail','friend@test.com');
                cb();
            }
        ],callback);
    }
    ,tearDown:function(callback) {
        var oSelf = this;
        async.parallel([
            function(cb){
                oSelf.oUser.delete(cb);
            }
            ,function(cb){
                oSelf.oFriend.delete(cb);
            }
        ],callback);
    }
    ,saveReferringUser:function(test) {
        var oSelf = this;
        test.expect(1);
        async.series([
            function(callback) {
                // This will both save the oFriend and set the oUser.nReferringUserID
                oSelf.oUser.setExtra('oReferringUser',oSelf.oFriend,callback);
            }
            ,function(callback) {
                test.equal(oSelf.oUser.get('nReferringUserID'),oSelf.oFriend.getNumKey());
                callback();
            }
        ],function(err){ App.wrapTest(err,test); })
    }
    ,lookupUserOnly:function(test){
        var oSelf = this;
        test.expect(1);
        var nStart;
        async.waterfall([
            function(callback) {
                nStart = new Date().getTime();
                // Lookup user by primary, numeric key and request some extras.
                var hQuery = {};
                hQuery[App.hClasses.User.sNumericKey] = oSelf.oUser.getNumKey();
                Base.lookup({
                    sClass:'User'
                    ,hQuery:hQuery
                },callback);
            }
            ,function(oUser,callback){
                console.log(oUser.sSource+' lookup time for primary key lookup of user only: '+(new Date().getTime()-nStart)+' ms\n');
                test.equal(oUser.getNumKey(),oSelf.oUser.getNumKey());
                callback();
            }
        ],function(err){ App.wrapTest(err,test); });
    }
    ,lookupUserAndExtras:function(test){
        var oSelf = this;
        test.expect(4);
        var nStart;
        async.waterfall([
            function(callback) {
                // This will both save the oFriend and set the oUser.nReferringUserID
                oSelf.oUser.setExtra('oReferringUser',oSelf.oFriend,callback);
            }
            ,function(oUser,callback) {
                test.equal(oSelf.oUser.get('nReferringUserID'),oSelf.oFriend.getNumKey());
                nStart = new Date().getTime();

                var hQuery = {};
                hQuery[oSelf.oUser.getSettings().sNumericKey] = oSelf.oUser.getNumKey();

                Base.lookup({
                    sClass:'User'
                    ,hQuery:hQuery
                    ,hExtras:{oReferringUser:true}
                },callback);
            }
            ,function(oUser,callback){
                console.log(oUser.sSource+' lookup time for primary key lookup of user + one object extra: '+(new Date().getTime()-nStart)+' ms\n');
                test.equal(oUser.getNumKey(),oSelf.oUser.getNumKey());
                test.equal(oUser.oReferringUser.getNumKey(),oSelf.oUser.get('nReferringUserID')); // Unless you also change the aKey settings for this relationship, changing the primary key for giggles could break this one.
                test.equal(oUser.sSource,'Redis');
                callback();
            }
        ],function(err){ App.wrapTest(err,test); });
    }
    ,deleteReferringUser:function(test){
        // What if the referring user is removed?  The references to it in the referred user should also be removed.
        var oSelf = this;
        test.expect(3);
        async.waterfall([
            function(callback) {
                // Add the friend as the referring user.
                oSelf.oUser.setExtra('oReferringUser',oSelf.oFriend,callback);
            }
            ,function(oUser,callback) {
                test.equal(oSelf.oUser.get('nReferringUserID'),oSelf.oFriend.getNumKey());
                // Now, delete the friend.
                oSelf.oFriend.delete(callback);
            }
            ,function(oUser,callback){
                // Now, try and lookup the friend (oFriend) via the referred user (oUser).
                var hQuery = {};
                hQuery[oSelf.oUser.getSettings().sNumericKey] = oSelf.oUser.getNumKey();
                Base.lookup({
                    sClass:'User'
                    ,hQuery:hQuery
                    ,hExtras:{oReferringUser:true}
                },callback);
            }
            ,function(oUser,callback){
                test.equal(oUser.getNumKey(),oSelf.oUser.getNumKey());
                test.equal(oUser.oReferringUser.getNumKey(),null);
                callback();
            }
        ],function(err){ App.wrapTest(err,test); });
    }
    ,lookupUserViaMySqlOnly:function(test){
        var oSelf = this;
        // Here is how to look up a user and specify that the data come only from MySql.
        test.expect(2);

        var nStart= new Date().getTime();
        var hQuery = {};
        hQuery[App.hClasses.User.sNumericKey] = oSelf.oUser.getNumKey();

        Base.lookup({sClass:'User',hQuery:hQuery,sSource:'MySql'},function(err,oUser){
            console.log(oUser.sSource+' lookup time for primary key lookup of user only: '+(new Date().getTime()-nStart)+' ms\n');
            test.equal(oUser.sSource,'MySql');
            test.equal(oUser.getNumKey(),oSelf.oUser.getNumKey());
            App.wrapTest(err,test);
        });
    }
};