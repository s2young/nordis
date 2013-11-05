nordis
=====

Bare-bones framework for rapid web application development that scales with you.

What Nords Will Do:

1. Code-first. You define your model in the configuration file and then go to work. Nordis will create tables
and columns in MySql for you.

2. Redis as DB. Nordis stores objects in both Redis and MySql and will always pull from Redis first if the object is available,
unless you specify otherwise in your code. This means consistently fast lookups without losing the peace-of-mind that
MySql provides.

3. Base class. Nordis objects include convenient methods to save, delete and serialize.

4. Collection class. Nordis collections make it easy to iterate, page, and serialize objects.

5. Extended properties on objects. Define objects or collections that exist as properties on other objects,
and you immediately have the ability to store and retrieve those objects and collections along with the parent object to
which they belong - in a single line of code (+ a callback of course).


Conventions:

Class definitions in the configuration file include a unique integer id. In the example code, the 'User' class has an 'nClass'
property of 1. Why? Easier, smaller namespacing of objects in the database.

Variables in the code start with lower-case strings to indicate, in simple terms, the type of the object.  For example,
nID is an integer id while sID is a string ID.  n = number (integer or float), s = string, b = boolean, o = typed object,
h = hash/dictionary/associative array/object literal, and c = collection. This is a modified Hungarian Notation style.

The framework actually uses the property names for things like
typing and serialization. This replaces the need to build types into configuration and constantly check a config file
to reference what a variable is. This is what most people will choke on, and so be it. This framework is mine, and was
open-sourced for use in some client projects.  I can't tell you how many times the convention has made my life easier,
so give it a chance. :-)

Collections:

Collections are stored in redis as Sorted Set data types, and are defined as properties on classes. In Redis, you cannot
just retrieve a list of items using any query.  Each sorted set is stored in Redis, named by the object to which it belongs.
The example config lists a 'User' class with a 'cFriends' collection. A user with an nID of 999 would have his cFriends
collection stored in Redis under the key '1:999:cFriends' where 1 = User.nClass, 999 User.nID, and 'cFriends' is the property
name.

You can instantiate a collection and pass in simple queries, but those will use MySql to retrieve the data. For example:

new Collection({sClass:'User',hQuery:{sWhere:'nID IS NOT NULL'}},function(err,cColl){
    // Now you have every user in your table.
    // Iterate using the async forEach or sync next method.
    cColl.forEach(function(oItem,nIndex){
        // Do something with each item if you please.
    });
});

Benchmarks:

Various unit tests include the option to increase the 'nTestSize' variable and increase test iterations. The tests print
out some crude benchmarks for things like write and read times for MySql & Redis. Don't read much, if anything, into these
tests. They might provide you some ballpark idea of the differences in performance in various scenarios, but not much more.



