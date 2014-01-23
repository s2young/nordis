var fs          = require('fs'),
    async       = require('async'),
    doT         = require('dot'),
    AppConfig         = require('./../AppConfig');

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
            AppConfig.fatal({sPath:sPath,err:err,hContext:hContext});
            fnCallback(err);
        }
    });
};

p.buildDotHelpers = function() {
    var oSelf = this;
    oSelf.defs = AppConfig.hConstants||{};
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
        if (fs.existsSync(process.env.GOBA_ENV_ROOT_NODE_DIR+'/templates'+sPath)) {
            bFound = true;
            return fs.readFileSync(process.env.GOBA_ENV_ROOT_NODE_DIR+'/templates'+sPath);
        }
        if (!bFound)
            AppConfig.error('Template not found. Tried app-specific path ('+process.env.sViewPath+sPath+') and root path ('+process.env.GOBA_ENV_ROOT_NODE_DIR+'/templates'+sPath+').');
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
//        AppConfig.debug(sPath);
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
