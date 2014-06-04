var async       = require('async'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    Config      = Base.prototype.Config;

var user; var follower;
module.exports = {
    base:{
        extras:{
            beforeEach:function(done) {

                async.series([
                    function(cb) {
                        user = Base.lookup({sClass:'User'});
                        user.set('name','TestUser');
                        user.set('email','test@test.com');
                        user.save(cb);
                    }
                    ,function(cb){
                        // Create but don't save the follower object.
                        follower = Base.lookup({sClass:'User'});
                        follower.set('name','TestUser\'s Follower');
                        follower.set('email','follower@test.com');
                        cb();
                    }
                ],done);
            }
            ,afterEach:function(callback) {
                var self = this;
                async.parallel([
                    function(cb){
                        user.delete(cb);
                    }
                    ,function(cb){
                        follower.delete(cb);
                    }
                ],callback);
            }
            ,saveReferringUser:function(done) {
                async.series([
                    function(callback) {
                        // This will both save the follower and set the user.referrer_id
                        user.setExtra('referring_user',follower,callback);
                    }
                    ,function(callback) {
                        user.get('referrer_id').should.equal(follower.getKey());
                        callback();
                    }
                ],done)
            }
            ,lookupUserOnly:function(done){

                var nStart;
                async.waterfall([
                    function(callback) {
                        nStart = new Date().getTime();
                        // Lookup user by primary, numeric key and request some extras.
                        var hQuery = {};
                        hQuery[Config.getClasses('User').sKeyProperty] = user.getKey();
                        Base.lookup({
                            sClass:'User'
                            ,hQuery:hQuery
                        },callback);
                    }
                    ,function(result,callback){
                        Config.log(result.sSource+' lookup time for primary key lookup of user only: '+(new Date().getTime()-nStart)+' ms');
                        result.getKey().should.equal(user.getKey());
                        callback();
                    }
                ],done);
            }
            ,lookupUserAndExtras:function(done){

                var nStart;
                async.waterfall([
                    function(callback) {
                        // This will both save the follower and set the user.referrer_id
                        user.setExtra('referring_user',follower,callback);
                    }
                    ,function(result,callback) {
                        result.get('referrer_id').should.equal(follower.getKey());
                        nStart = new Date().getTime();

                        var hQuery = {};
                        hQuery[user.getSettings().sKeyProperty] = user.getKey();

                        Base.lookup({
                            sClass:'User'
                            ,hQuery:hQuery
                            ,hExtras:{referring_user:true}
                        },callback);
                    }
                    ,function(result,callback){
                        Config.log(result.sSource+' lookup time for primary key lookup of user + one object extra: '+(new Date().getTime()-nStart)+' ms');
                        result.getKey().should.equal(user.getKey());
                        result.referring_user.getKey().should.equal(user.get('referrer_id')); // Unless you also change the aKey settings for this relationship, changing the primary key for giggles could break this one.
                        result.sSource.should.equal('Redis');
                        callback();
                    }
                ],done);
            }
            // What if the referring user is removed?  The references to it in the referred user should also be removed.
            ,deleteReferringUser:function(done){

                async.waterfall([
                    function(callback) {
                        // Add the follower as the referring user.
                        user.setExtra('referring_user',follower,callback);
                    }
                    ,function(result,callback) {
                        result.get('referrer_id').should.equal(follower.getKey());
                        // Now, delete the follower.
                        follower.delete(callback);
                    }
                    ,function(result,callback){
                        // Now, try and lookup the follower (follower) via the referred user (user).
                        var hQuery = {};
                        hQuery[result.getSettings().sKeyProperty] = user.getKey();
                        Base.lookup({
                            sClass:'User'
                            ,hQuery:hQuery
                            ,hExtras:{referring_user:true}
                        },callback);
                    }
                    ,function(result,callback){
                        result.getKey().should.equal(user.getKey());
                        (result.referring_user.hData.id===undefined).should.be.ok;
                        callback();
                    }
                ],done);
            }
            // Here is how to look up a user and specify that the data come only from MySql.
            ,lookupUserViaMySqlOnly:function(done){
                
                var nStart= new Date().getTime();
                var hQuery = {};
                hQuery[Config.getClasses('User').sKeyProperty] = user.getKey();

                Base.lookup({sClass:'User',hQuery:hQuery,sSource:'MySql'},function(err,result){
                    Config.log(result.sSource+' lookup time for primary key lookup of user only: '+(new Date().getTime()-nStart)+' ms');
                    result.sSource.should.equal('MySql');
                    result.getKey().should.equal(user.getKey());
                    done();
                });
            }
        }
    }
};