var querystring = require('querystring'),
    url         = require('url'),
    https       = require('https'),
    http        = require('http'),
    String      = require('./../../Utils/String')
    App         = require('./../../AppConfig');

var REST = function(){

};
var p = REST.prototype;

p.request = function(hOpts,fnCallback) {
    var oResult = {data:''};
    if (!hOpts)
        throw 'No options passed.';
    else if (!hOpts.host)
        throw 'Property not specified (hOpts.host).';
    else {
        if (!hOpts.port)
            hOpts.port = 80;
        if (!hOpts.method)
            hOpts.method = 'GET';
    }

    hOpts.sData = (hOpts.sData) ? hOpts.sData : '';
    if (hOpts.hData) {
        if (hOpts.method == 'POST')
            hOpts.sData = querystring.stringify(hOpts.hData);
        else if (hOpts.method == 'GET') {
            hOpts.path += '?'+querystring.stringify(hOpts.hData);
        }
    }

    var hOptions = {
        host:hOpts.host,
        port:hOpts.port,
        path:hOpts.path,
        method:hOpts.method
    };

    if (hOpts.method == 'POST' && hOpts.sData && hOpts.sData.length)
        hOptions.headers = {
            'Content-Type':'application/x-www-form-urlencoded',
            'Content-Length':hOpts.sData.length
        };

    // Set up the request
    var oRequest = http.request(hOptions, function(res) {
        res.setEncoding('utf8');
        res.on('data', function (data) {
            if (data != undefined)
                oResult.data += data;
        });
        res.on('error', function (error) {
            App.error(error);
            fnCallback(error);
        });
        res.on('end', function() {
            oResult.statusCode = res.statusCode;
            oResult.headers = res.headers;
            fnCallback(null,oResult);
        });
    });

    if (hOpts.sData)
        oRequest.write(hOpts.sData);

    oRequest.end();
};

p.secureRequest = function(hOpts,fnCallback) {
    var oResult = {data:''};
    if (!hOpts)
        fnCallback('No options passed.');
    else if (!hOpts.host)
        fnCallback('Property not specified (hOpts.host).');
    else {
        if (!hOpts.port)
            hOpts.port = 443;
        if (!hOpts.method)
            hOpts.method = 'GET';
    }

    hOpts.sData = (hOpts.sData) ? hOpts.sData : '';
    if (hOpts.hData) {
        if (hOpts.method == 'POST')
            hOpts.sData = querystring.stringify(hOpts.hData);
        else if (hOpts.method == 'GET') {
            hOpts.path += '?'+querystring.stringify(hOpts.hData);
        }
    }

    var hOptions = {
        host:hOpts.host,
        port:hOpts.port,
        path:hOpts.path,
        method:hOpts.method,
        rejectUnauthorized:false,
        agent:false
    };

    if (hOpts.method == 'POST' && hOpts.sData.length)
        hOptions.headers = {
            'Content-Type':'application/x-www-form-urlencoded',
            'Content-Length':hOpts.sData.length
        };

    // Set up the request
    var oRequest = https.request(hOptions, function(res) {
        res.setEncoding('utf8');
        res.on('data', function (data) {
            oResult.data += data;
        });
        res.on('error', function (err) {
            App.error(err);
            fnCallback(err);
        });
        res.on('end', function(anything) {
            oResult.statusCode = res.statusCode;
            oResult.headers = res.headers;
            if (fnCallback)
                fnCallback(null,oResult);
        });
    });

    oRequest.on('error', function (err) {
            App.error(err);
        fnCallback(err);
    });

    if (hOpts.sData)
        oRequest.write(hOpts.sData);

    oRequest.end();
};

module.exports = new REST();