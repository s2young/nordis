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

5. Extended properties on objects. In your model define objects or collections that exist as properties on other objects,
and you immediately have the ability to store and retrieve those objects and collections along with the parent object to
which they belong - in a single line of code.


Conventions:

Class definitions in the configuration file include a unique integer id. This is used in storing keys in Redis.  Integers
are shorter than string class names and make it easy to store objects in unique namespaces in Redis.

Variables in the code start with lower-case strings to indicate, in simple terms, the type of the object.  For example,
nID is an integer id while sID is a string ID.  n = number (integer or float), s = string, b = boolean.  I personally use
o for typed objects, h for hash/dictionary/object literals, and d for dates. The serialization code actually looks at this to
output things properly but you don't have to use these conventions in your own objects (though we may need to work through
some bugs as a result).



