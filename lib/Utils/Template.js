var util        = require('util'),
    fs          = require('fs'),
    async       = require('async'),
    doT         = require('dot'),
    Base        = require('./../Core/Base'),
    App         = require('./../Core/AppConfig');

var Template = function(){
    var oSelf = this;
    oSelf.hTemplates = {};
    oSelf.hPaths = {};
    doT.templateSettings = {
        evaluate:    /\[\[([\s\S]+?)\]\]/g,
        interpolate: /\[\[=([\s\S]+?)\]\]/g,
        encode:      /\[\[!([\s\S]+?)\]\]/g,
        use:         /\[\[#([\s\S]+?)\]\]/g,
        define:      /\[\[##\s*([\w\.$]+)\s*(\:|=)([\s\S]+?)#\]\]/g,
        conditional: /\[\[\?(\?)?\s*([\s\S]*?)\s*\]\]/g,
        iterate:     /\[\[~\s*(?:\]\]|([\s\S]+?)\s*\:\s*([\w$]+)\s*(?:\:\s*([\w$]+))?\s*\]\])/g,
        varname: 'it',
        strip: false,
        append: true,
        selfcontained: false
    };
    oSelf.buildDotHelpers();
};
var p = Template.prototype;

p.compile = function(sPath,hContext,fnCallback) {
    var oSelf = this;

    if (!oSelf.defs)
        oSelf.buildDotHelpers();

    if (!oSelf.hTemplates)
        oSelf.hTemplates = {};

    async.waterfall([
        function(callback){
            if (oSelf.hTemplates[sPath]) {
                callback(null,oSelf.hTemplates[sPath]);
            } else if (!fs.existsSync(sPath))
                callback('Not found: '+sPath);
            else
                fs.readFile(sPath,'utf8',callback);
        }
    ],function(err,sContent){
        oSelf.hTemplates[sPath] = doT.template(sContent,undefined,oSelf.defs);

        try {
            var sResult = oSelf.hTemplates[sPath](hContext);
            fnCallback(null,sResult);
        } catch (err) {
            App.fatal({sPath:sPath,err:err,hContext:hContext});
            fnCallback(err);
        }
    });
};

p.generateMessage = function(sPath,nMedium,hContext,fnCallback) {
    var oSelf = this;
    var sName;
    sPath = sPath.replace('.tt','');
    if (!sPath.match(/\.js$/))
        sPath += '.js';

    if (nMedium) {
        sName = 'message/';
        if (nMedium == App.nMedium_Email && !sPath.match(new RegExp(/^email/))) {
            sName += 'email/' + sPath;
        } else if (nMedium == App.nMedium_TextMsg && !sPath.match(new RegExp(/^sms/))) {
            sName += 'sms/' + sPath;
        } else if ((nMedium == App.nMedium_Push || nMedium == App.nMedium_Android || nMedium == App.nMedium_iOS)
                    && !sPath.match(new RegExp(/^push/))) {
            sName += 'push/' + sPath;
        } else if (nMedium == App.nMedium_Facebook && !sPath.match(new RegExp(/^facebook/))) {
            sName += 'facebook/' + sPath;
        } else if (nMedium == App.nMedium_Twitter && !sPath.match(new RegExp(/^twitter/))) {
            sName += 'twitter/' + sPath;
        } else {
            sName += sPath;
        }
    }

    if (sName) {
        async.waterfall([
            function(callback) {
                // Make sure we have the right path for the given api consumer.
                if (hContext.oMsg && hContext.oMsg.get('nApiConsumerID'))
                    callback(null,process.env.NORDIS_ENV_ROOT_NODE_DIR+'/templates/engage');
                else
                    callback('API Consumer not loaded. Always call App.init first!');
            },
            function(sRoot,callback) {
                // Now, that we have the, render the template.
                switch (Number(nMedium)) {
                    case App.nMedium_None:
                        callback('No medium available for this recipient.');
                        break;
                    case App.nMedium_TextMsg:
                    case App.nMedium_Push:
                    case App.nMedium_Android:
                    case App.nMedium_iOS:
                    case App.nMedium_Facebook:
                    case App.nMedium_Twitter:
//                    App.debug('Template: '+sRoot+'/'+sName);
                        if (fs.existsSync(sRoot+'/'+sName)) {
                            var TxtTemplate;
                            TxtTemplate = require(sRoot+'/'+sName);
                            TxtTemplate.render(hContext,fnCallback);
                        } else
                            callback('Message template not found: '+sRoot+'/'+sName,null);
                        break;
                    default:
                        sName = sName.replace('.js','.dot');
//                    App.debug('Template: '+sRoot+'/'+sName);
                        if (fs.existsSync(sRoot+'/'+sName)) {
                            var oTemplate = doT.template(fs.readFileSync(sRoot+'/'+sName),undefined,oSelf.defs);
                            var resultText = oTemplate(hContext);
                            callback(null,resultText);
                        } else
                            callback('Message template not found: '+sRoot+'/'+sName,null);
                        break;
                }
            }
        ],function(err,sTemplate){
            fnCallback(err,sTemplate);
        });
    } else
        fnCallback('Template not found for '+sPath+'; sName: '+sName);
};

p.buildDotHelpers = function() {
    var oSelf = this;
    oSelf.defs = App.hConstants;
    oSelf.defs.getTimeout = function(sProp) {
        if (App.hAppSettings['schedule.js'][sProp])
            return ((App.hAppSettings['schedule.js'][sProp]/1000)/60);
        else
            return 'few';

    }
    oSelf.defs.loadfile = function(sPath) {
        var bFound = false;

        if (oSelf.hTemplates[sPath]) {
            bFound = true;
            return oSelf.hTemplates[sPath];
        }


        if (process.env.sViewPath && fs.existsSync(process.env.sViewPath+sPath)) {
            bFound = true;
            return fs.readFileSync(process.env.sViewPath+sPath);
        }
        if (fs.existsSync(process.env.NORDIS_ENV_ROOT_NODE_DIR+'/templates'+sPath)) {
            bFound = true;
            return fs.readFileSync(process.env.NORDIS_ENV_ROOT_NODE_DIR+'/templates'+sPath);
        }
        if (!bFound)
            App.error('Template not found. Tried app-specific path ('+process.env.sViewPath+sPath+') and root path ('+process.env.NORDIS_ENV_ROOT_NODE_DIR+'/templates'+sPath+').');
        return '';
    };
};

var self = new Template();
module.exports = self;
/**
 * This is a static way of rendering templates, specifically for use with expressjs-powered sites.
 * @param sPath
 * @param hContext
 * @param fnCallback
 */
module.exports.compile = function(sPath,hContext,fnCallback) {
//        App.debug(sPath);
    fs.readFile(sPath,'utf8',function(err,sContent){
        if (err)
            fnCallback(err);
        else {
            var oTemplate = doT.template(sContent,undefined,self.defs);
            try {
                var sResult = oTemplate(hContext);
                fnCallback(null,sResult);
            } catch (err) {
//                console.log(oTemplate.toString());
                fnCallback(err);
            }
        }
    });
};
