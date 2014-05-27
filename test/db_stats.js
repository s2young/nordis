var async       = require('async'),
    request     = require('request'),
    should      = require('should'),
    Base        = require('./../lib/Base'),
    Stats       = require('./../lib/Utils/Stats'),
    Collection  = require('./../lib/Collection'),
    AppConfig   = require('./../lib/AppConfig');

/**
 * This test is all about confirming the accuracy of the stats-tracking capabilities of Nordis. There are a couple
 * of types of stats one can track using Nordis: 1) those that can be recreated via queries of existing tables, and
 * 2) those that are stored in nordis and cannot be recreated from the data model directly.
 *
 * For example, you can easily determine how many new users you have by querying your users table. If you want to
 * track unique visits to a page on your site, that's a different kind of stat.  By defining your stats in your
 * configuration file you can track either type.
 *
 * These tests confirm the db-related stats are accurate.
 *
 */

var nTestSize = 10;
var dNow = new Date();
var current_count = 0;
var oApp;

module.exports = {
    stats:{
        before:function(done) {
            async.waterfall([
                // Get the current, total count of users.
                function(cb){
                    Stats.process(function(){
                        Base.loadAppSingleton('app',cb);
                    });
                }
                ,function(oResult,cb) {
                    oApp = oResult;
                    oApp.loadExtras({users:{hExtras:{alltime:true}}},cb);
                }
                ,function(n,cb) {
                    if (oApp.users && oApp.users.alltime && oApp.users.alltime.nTotal) {
                        current_count = oApp.users.alltime.first().get('count');
                    }
                    cb();
                }
            ],done);
        }
        ,after:function(done) {
            async.series([
                function(callback) {
                    // Delete just the users created for this test, named via timestamp.
                    Collection.lookup({sClass:'User',hQuery:{name:dNow.getTime()}},function(err,cColl){
                        if (err)
                            callback(err);
                        else
                            cColl.delete(callback);
                    });
                }
            ],done);
        }
        ,db:{
            userCount:function(done){

                async.series([
                    // Create the user accounts with which we'll make hits.
                    function(callback) {
                        var q = [];
                        for (var n = 0; n < nTestSize; n++) {
                            q.push(n);
                        }
                        async.forEach(q,function(n,cb) {
                            var user = Base.lookup({sClass:'User'});
                            user.set('name',dNow.getTime());
                            user.set('email','testfollower'+n+'@test.com');
                            user.save(cb);
                        },callback);
                    }
                    // Next, lookup the user stat.
                    ,function(callback) {
                        Stats.process(function(err){
                            if (err)
                                callback(err);
                            else
                                oApp.loadExtras({
                                    users:{hExtras:{alltime:true}}
                                },callback);
                        });
                    }
                    // Next, trackStats for each user - randomly setting the nFakeCount to make sure that each user is only counted once.
                    ,function(callback) {
                        var new_count;
                        if (oApp.users && oApp.users.alltime)
                            new_count = oApp.users.alltime.first().get('count');
                        (current_count+nTestSize).should.equal(new_count);
                        callback();
                    }
                ],done);
            }
        }
    }
};