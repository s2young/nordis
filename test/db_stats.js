var async       = require('async'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    AppConfig         = require('./../lib/AppConfig');

/**
 * This test is all about confirming the accuracy of the stats-tracking capabilities of Nordis. There are a couple
 * of types of stats one can track using Nordis: 1) those that can be recreated via queries of existing tables, and
 * 2) those that cannot.
 *
 * For example, you can easily determine how many new users you have by querying your users table. If you want to
 * track unique visits to a page on your site, that's a different kind of stat.  By defining your stats in your
 * configuration file you can track either type.
 *
 * These tests confirm the redis-only stat tracking system is working properly.
 *
 */
var nTestSize = 50;

module.exports = {
    setUp:function(callback) {
        callback();
    }
    ,tearDown:function(callback) {
        callback();
    }
};