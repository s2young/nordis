var async       = require('async'),
    should      = require('should'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    Config      = require('./../lib/AppConfig');

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
                        follower.save(cb);
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
                        user.set('referrer_id',follower.getKey());
                        user.save(callback);
                    }
                    ,function(callback) {
                        user.loadExtras({referring_user:{sSource:'MySql'}},callback);
                    }
                    ,function(callback) {
                        user.referring_user.sSource.should.equal('MySql');
                        user.referring_user.getKey().should.equal(follower.getKey());
                        callback();
                    }
                    ,function(callback) {
                        user.loadExtras({referring_user:{sSource:'Redis'}},callback);
                    }
                    ,function(callback) {
                        if (!Config.Redis.hOpts.default.bSkip) user.referring_user.sSource.should.equal('Redis');
                        callback();
                    }
                ],done)
            }
            ,lookupUserOnly:function(done){


                var nStart = new Date().getTime();
                // Promised-based way of retrieving a base object.
                Base.lookupP({sClass:'User',hQuery:{id:user.getKey()}})
                    .then(function(result){
                        Config.log(result.sSource+' lookup time for primary key lookup of user only: '+(new Date().getTime()-nStart)+' ms');
                        result.getKey().should.equal(user.getKey());
                    })
                    .then(null,Config.handleTestError)
                    .done(done);

            }
            ,lookupUserAndExtras:function(done){

                var nStart;
                async.series([
                    function(callback) {
                        user.set('referrer_id',follower.getKey());
                        user.save(callback);
                    }
                    ,function(callback) {
                        nStart = new Date().getTime();
                        Base.lookupP({sClass:'User',hQuery:{id:user.getKey()},hExtras:{referring_user:{sSource:'MySql'}}})
                            .then(function(result){
                                Config.log(result.sSource+' lookup time for primary key lookup of user + one object extra: '+(new Date().getTime()-nStart)+' ms');
                                result.getKey().should.equal(user.getKey());
                                result.referring_user.getKey().should.equal(user.get('referrer_id'));
                                result.referring_user.getKey().should.equal(follower.getKey());
                                result.referring_user.sSource.should.equal('MySql');
                                if (Config.Redis.hOpts.default.bSkip)
                                    result.sSource.should.equal('MySql');
                                else
                                    result.sSource.should.equal('Redis');
                            })
                            .then(null,Config.handleTestError)
                            .done(callback);
                    }
                ],done);
            }
            // What if the referring user is removed?  The references to it in the referred user should also be removed.
            ,deleteReferringUser:function(done){

                async.waterfall([
                    function(callback) {
                        user.set('referrer_id',follower.getKey());
                        user.save(callback);
                    }
                    ,function(result,callback) {
                        // Now, delete the follower.
                        follower.delete(callback);
                    }
                    ,function(result,callback){
                        // Now, try and lookup the follower (follower) via the referred user (user).
                        Base.lookupP({sClass:'User',hQuery:{id:user.getKey()},hExtras:{referring_user:true}})
                            .then(function(result){
                                result.getKey().should.equal(user.getKey());
                                (result.referring_user.hData.id===undefined).should.be.ok;
                            })
                            .then(null,Config.handleTestError)
                            .done(callback);
                    }
                ],done);
            }
            // Here is how to look up a user and specify that the data come only from MySql.
            ,lookupUserViaMySqlOnly:function(done){
                
                var nStart= new Date().getTime();
                var hQuery = {};
                hQuery[Config.getClasses('User').sKeyProperty] = user.getKey();

                // Callback-style.
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