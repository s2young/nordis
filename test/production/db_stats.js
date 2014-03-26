var async       = require('async'),
    request     = require('request'),
    express     = require('express'),
    Middleware  = require('./../../lib/Utils/Middleware'),
    Str         = require('./../../lib/Utils/String'),
    Base        = require('./../../lib/Base'),
    Collection  = require('./../../lib/Collection'),
    AppConfig         = require('./../../lib/AppConfig');

/**
 * This test is all about confirming the accuracy of the stats-tracking capabilities of Nordis. There are a couple
 * of types of stats one can track using Nordis: 1) those that can be recreated via queries of existing tables, and
 * 2) those that cannot.
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
var nPort = 2002; // Port on which to run api instance during test.
var current_count = 0;

module.exports = {
    setUp:function(callback) {
        var self = this;
        async.series([
            // Get the current, total count of users.
            function(cb){
                AppConfig.processStats(function(err){
                    if (err)
                        callback(err);
                    else
                        AppConfig.oApp.loadExtras({
                            users:{hExtras:{all:true}}
                        },cb);
                });
            }
            ,function(cb) {
                if (AppConfig.oApp.users && AppConfig.oApp.users.all) {
                    current_count = AppConfig.oApp.users.all.first().get('count');
                }
                console.log('current_count: '+current_count);
                cb();
            }
        ],callback);
    }
    ,tearDown:function(callback) {
        async.parallel([
            // Delete just the users created for this test, named via timestamp.
            function(cb) {
                new Collection({sClass:'User',hQuery:{name:dNow.getTime()}},function(err,cColl){
                    if (err)
                        cb(err);
                    else
                        cColl.delete(cb);
                });
            }
        ],callback);
    }
    ,userCount:function(test){
        test.expect(1);
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
                    user.save(function(err){
                        if (err)
                            callback(err);
                        else
                            cb();
                    });
                },callback);
            }
            // Next, lookup the user stat.
            ,function(callback) {
                AppConfig.processStats(function(err){
                    if (err)
                        callback(err);
                    else
                        AppConfig.oApp.loadExtras({
                            users:{hExtras:{all:true}}
                        },callback);
                });
            }
            // Next, trackStats for each user - randomly setting the nFakeCount to make sure that each user is only counted once.
            ,function(callback) {
                var new_count;
                if (AppConfig.oApp.users && AppConfig.oApp.users.all) {
                    new_count = AppConfig.oApp.users.all.first().get('count');
                    console.log('new_count: '+new_count);
                }
                test.equal((current_count+nTestSize),(current_count+new_count));
                callback();
            }
        ],function(err){AppConfig.wrapTest(err,test)});
    }
};