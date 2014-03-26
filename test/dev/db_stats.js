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
var server;

module.exports = {
    setUp:function(callback) {
        var self = this;
        async.series([
            //Create users to make sure there are users to count.
            function(callback){
                AppConfig.flushStats(callback);
            }
        ],callback);
        callback();
    }
    ,userCount:function(test){
        test.expect(1);
        var current_count = 0;

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
                            users:{hExtras:{hour:true}}
                        },callback);
                });
            }
            // Next, trackStats for each user - randomly setting the nFakeCount to make sure that each user is only counted once.
            ,function(callback) {
                current_count = (AppConfig.oApp.active_users && AppConfig.oApp.active_users.hour && AppConfig.oApp.active_users.hour.first()) ? AppConfig.oApp.active_users.hour.first().get('count') : 0;

            }
            // Next, process the stats
            ,function(callback) {
                AppConfig.processStats(callback);
            }
            // Reload the stats.
            ,function(callback){
                AppConfig.oApp.loadExtras({
                    active_users:{hExtras:{hour:true}}
                },callback);
            }
            // Validate our counts - which should be ONE because no matter the test size there's just one user being tracked here.
            ,function(callback) {
                var nApiRequests = (AppConfig.oApp.active_users && AppConfig.oApp.active_users.hour && AppConfig.oApp.active_users.hour.first()) ? AppConfig.oApp.active_users.hour.first().get('count') : 0;
//                console.log('nApiRequests:'+nApiRequests);
                test.equal(nApiRequests,current_count+nTestSize);
                callback();
            }
            // Now remove the users.
            ,function(callback) {
                cUsers.delete(callback);
            }
        ],function(err){AppConfig.wrapTest(err,test)});
    }
};