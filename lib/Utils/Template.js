var fs      = require('fs'),
    async   = require('async'),
    doT     = require('dot'),
    Config  = require('./../AppConfig');

var Template = function(){
    var oSelf = this;
    oSelf.hTemplates = {};
    oSelf.hSettings = {
        evaluate:    /\[\[([\s\S]+?)\]\]/g,
        interpolate: /\[\[=([\s\S]+?)\]\]/g,
        encode:      /\[\[!([\s\S]+?)\]\]/g,
        use:         /\[\[#([\s\S]+?)\]\]/g,
        define:      /\[\[##\s*([\w\.$]+)\s*(\:|=)([\s\S]+?)#\]\]/g,
        conditional: /\[\[\?(\?)?\s*([\s\S]*?)\s*\]\]/g,
        iterate:     /\[\[~\s*(?:\]\]|([\s\S]+?)\s*\:\s*([\w$]+)\s*(?:\:\s*([\w$]+))?\s*\]\])/g,
        varname: 'hData',
        strip: false,
        append: true,
        selfcontained: false
    };
    oSelf.buildDotHelpers();
};
var p = Template.prototype;

p.buildDotHelpers = function() {
    var oSelf = this;
    oSelf.defs = {};

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
        if (!bFound && fs.existsSync(Config.NORDIS_ENV_ROOT_DIR+sPath)) {
            bFound = true;
            return fs.readFileSync(Config.NORDIS_ENV_ROOT_DIR+sPath);
        }
        var project_path;
        if (!bFound) {
            var path = require('path');
            project_path = path.resolve(__dirname, "../.."+sPath);

            if (fs.existsSync(project_path)) {
                bFound = true;
                return fs.readFileSync(project_path);
            }
        }
        if (!bFound)
            Config.error('Template not found. Tried app-specific path ('+process.env.sViewPath+sPath+') and root path ('+Config.NORDIS_ENV_ROOT_DIR+sPath+') and nordis project path ('+project_path+').');
        return '';
    };
};

var self = new Template();


// This is the function that expressjs uses to render data-bound templates.
// This function also caches the templates when the environment variable (NORDIS_ENV)
// isn't set 'local.' That means that template changes will be reflected immediately on a
// localhost environment but require a restart in a staging or production environment.
var compile = function(sPath,hData,fnCallback){
    if (!self.defs)
        self.buildDotHelpers();

    async.series([
        function(cb){
            // This code caches templates if not in a local environment.
            // This means the app must be restarted if views change.
            if (self.hTemplates[sPath] && self.hTemplates[sPath] instanceof Function) {
                cb();
            } else if (!fs.existsSync(sPath))
                cb('Not found: '+sPath);
            else
                fs.readFile(sPath,'utf8',function(err,sTemplate){
                    if (!err)
                        self.hTemplates[sPath] = doT.template(sTemplate,self.hSettings,self.defs);
                    cb(err);
                });
        }
    ],function(err){
        if (err)
            fnCallback(err);
        else
            try {
                fnCallback(null,self.hTemplates[sPath](hData));
            } catch (err) {
                fnCallback('Template error on '+sPath+'; '+err.toString());
            }
    });
};
/**
 * For use on dev/local environments so template changes are immediately reflected in the app.
 * @param sPath
 * @param hData
 * @param fnCallback
 */
var compileNoCache = function(sPath,hData,fnCallback){
    if (!self.defs)
        self.buildDotHelpers();

    async.series([
        function(cb){
            if (!fs.existsSync(sPath))
                cb('Not found: '+sPath);
            else
                fs.readFile(sPath,'utf8',function(err,sTemplate){
                    if (!err)
                        self.hTemplates[sPath] = doT.template(sTemplate,self.hSettings,self.defs);
                    cb(err);
                });
        }
    ],function(err){
        if (err)
            fnCallback(err);
        else
            try {
                fnCallback(null,self.hTemplates[sPath](hData));
            } catch (err) {
                fnCallback('Template error on '+sPath+'; '+err.toString());
            }
    });
};

module.exports = self;
/**
 * This is a static way of rendering templates, specifically for use with expressjs-powered sites.
 * @param sPath
 * @param hContext
 * @param fnCallback
 */
module.exports.compile = compile;
module.exports.compileNoCache = compileNoCache;