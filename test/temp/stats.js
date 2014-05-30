var async       = require('async'),
    request     = require('request'),
    should      = require('should'),
    express     = require('express'),
    Base        = require('./../../lib/Base'),
    Stats       = require('./../../lib/Utils/Stats'),
    Collection  = require('./../../lib/Collection'),
    Middleware  = require('./../../lib/Utils/Middleware'),
    AppConfig   = require('./../../lib/AppConfig');

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
var server;

module.exports = {
    stats:{
        db:{
            before:function(done) {
                Stats.flush(done);
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
            ,userCount:function(done){

                async.series([
                    // Create the user accounts with which we'll make hits.
                    function(callback) {
                        var q = [];
                        for (var n = 0; n < nTestSize; n++) {
                            q.push(n);
                        }
                        async.forEachLimit(q,10,function(n,cb) {
                            var user = Base.lookup({sClass:'User'});
                            user.set('name',dNow.getTime());
                            user.set('email','testfollower'+n+'@test.com');
                            user.save(cb);
                        },callback);
                    }
                    // Process the stats.
                    ,function(callback) {
                        Stats.process(callback);
                    }
                    // Look up the stats.
                    ,function(callback) {
                        Base.lookupP({sClass:'App',hQuery:{id:'app'},hExtras:{users:{hExtras:{alltime:true}}}})
                            .then(function(oApp){
                                var new_count;
                                if (oApp.users && oApp.users.alltime)
                                    new_count = oApp.users.alltime.first().get('count');
                                nTestSize.should.equal(new_count);
                            })
                            .then(null,function(err){throw err})
                            .done(callback);
                    }
                ],done);
            }
        }
        ,redis:{
            before:function(done) {
                Stats.flush(done);
            }
            ,after:function(done) {
                server.close();
                done();
            }
            ,hitCount:function(done){
                async.series([
                    //Simulate homepage hits.
                    function(callback){
                        var aHits = [];
                        for (var n = 0; n < nTestSize; n++) {
                            aHits.push(1);
                        }
                        async.forEachLimit(aHits,10,function(n,cb){
                            Stats.track({
                                sStat:'hits',
                                Params:'/'
                            },cb);
                        },callback);
                    }
                    // Process the stats.
                    ,function(callback){
                        Stats.process(callback);
                    }
                    // Look up the stats and confirm the count.
                    ,function(callback) {
                        Base.lookupP({sClass:'App',hQuery:{id:'app'},hExtras:{hits:{hExtras:{month:true,day:true,year:true,alltime:true}}}})
                            .then(function(oApp){
                                oApp.hits.month.first().get('count').should.equal(nTestSize);
                                oApp.hits.day.first().get('count').should.equal(nTestSize);
                                oApp.hits.year.first().get('count').should.equal(nTestSize);
                                oApp.hits.alltime.first().get('count').should.equal(nTestSize);
                            })
                            .then(null,function(err){throw err})
                            .done(callback);
                    }
                    // Start the api server, so we can look stats up via API call.
                    ,function(callback) {
                        var exp_app = express();
                        server = exp_app.listen(2010);
                        exp_app.use(require('body-parser')());
                        exp_app.use(Middleware.apiParser);
                        callback();
                    }
                    // Look up stats via API
                    ,function(callback) {
                        Base.requestP('get','http://localhost:2010/stat/hits/all')
                            .then(function(hResult){
                                hResult.hits.month.aObjects[0].count.should.equal(nTestSize);
                                hResult.hits.day.aObjects[0].count.should.equal(nTestSize);
                                hResult.hits.year.aObjects[0].count.should.equal(nTestSize);
                                hResult.hits.alltime.aObjects[0].count.should.equal(nTestSize);
                            })
                            .then(null,function(err){throw err})
                            .done(callback);
                    }
                ],done);

            }
        }
    }
};