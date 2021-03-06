"use strict";

let classHandle = {};
let method_filter;
let method_exclude;
let method_exclude_set = false;

rpc.exports = {
  setMethodFilter: function (filter) {
    method_filter = new RegExp(filter);
  },
  setMethodExlude: function(filter) {
    if (filter)
      method_exclude_set = true;
    method_exclude = new RegExp(filter);
  },
  enumerateClasses: function() {
    startEnumerateClasses();
  },
  providedClassesHook: function(providedClasses) {
    startProvidedClassesHook(providedClasses);
  }
}

function startEnumerateClasses() {
  if (Java.available) {
    Java.perform(function(){
      try{
        Java.enumerateLoadedClasses({
          onMatch: function(class_discovered) {
            send({ type: "class_discovered", data: class_discovered });
          },
          onComplete: function() {
          }
        });
      } catch (err) {
        send({ type: "errorGeneric", data: "Java.perform error" });
        console.error(err);
      }
    });
  } else {
    send({ type: "errorGeneric", data: "Java.available error" });
  }
}

function startProvidedClassesHook(providedClasss){
  //TODO performNow or perform?
  Java.performNow(function(){
      providedClasss.map(function(classNameToHook){
        hookClass(classNameToHook);
    });
  });
}


/******CLASS HOOK FUNCTION******/

function hookClass(classNameToHook){

  try {
    classHandle = Java.use(classNameToHook);
  } catch (err) {
    send({ type: "errorGeneric", data: "Java.use error in class: " +
      classNameToHook + " - skipping class" });
    console.error(err);
    return;
  }

  /*HOOK CONSTRUCTORS*/
  try {
    if (classHandle.$init.overloads.length > 0) {
      hookConstructors(classNameToHook);
    } else {
      send({ type: "info", data: "No constructor to hook in class: " + classNameToHook });
    }
  } catch (err) {
    console.error(err);
  }

  /*HOOK FUNCTIONS*/
  var allPropertyNames = getAllPropertyNames(classHandle);
  var allFunctionNames = getAllFunctionNames(allPropertyNames);

  allFunctionNames.map(function(methodNameToHook){
    /*return if method name matches user exlcude regex*/
    if(method_exclude_set && method_exclude.test(methodNameToHook)){
      return;
    }
    /*perform hook if method name matches user filter regex*/
    if(method_filter.test(methodNameToHook)){
      try{
        if (!(classHandle[methodNameToHook].overloads.length > 1)){
          hookMethod(classNameToHook, methodNameToHook);
        } else {
          hookOverloadedMethod(classNameToHook, methodNameToHook);
        }
      } catch (err) {
        console.error(err);
      }
  }
  });
}


/*
METHOD AND CONSTRUCTOR HOOK FUNCTIONS
*/
function hookConstructors(classNameToHook){
  var constructorMethods = classHandle.$init.overloads;
  for (var i in constructorMethods){
    var argTypes = constructorMethods[i].argumentTypes.map(function(a) {return a.className;});
    try{
      send({
        type: "constructorHooked",
        data: {
          methodType: "CONSTRUCTOR",
          className: classNameToHook,
          args: argTypes
        }
      });

      classHandle.$init.overload.apply(this, argTypes).implementation = function() {

        var args = Array.prototype.slice.call(arguments);
        // send message on hook
        send({
          type: "constructorCalled",
          data: {
            methodType: "CONSTRUCTOR",
            className: classNameToHook,
            // args: JSON.stringify(args)
            argTypes: argTypes,
            args: args + ""
          }
        });

        return this.$init.apply(this, args);
      }
    } catch (err){
      console.error(err);
    }
  }
}

function hookMethod(classNameToHook, methodNameToHook){
  var argTypes = classHandle[methodNameToHook].argumentTypes.map(function(a) {return a.className;});
  try{
    // send message to indicate the method is being hooked
    send({
      type: "methodHooked",
      data: {
        methodType: "METHOD",
        className: classNameToHook,
        methodName: methodNameToHook,
        args: argTypes
      }
    });

    classHandle[methodNameToHook].implementation = function() {
      var args = Array.prototype.slice.call(arguments);
      var retVal = this[methodNameToHook].apply(this, args);
      // send message on hook
      send({
        type: "methodCalled",
        data: {
          methodType: "METHOD",
          className: classNameToHook,
          methodName: methodNameToHook,
          argTypes: argTypes,
          // args: JSON.stringify(args)
          args: args + "",
          ret: retVal + ""
        }
      });

      return retVal;
    };
  }catch (err){
    send({
      type: "errorHook",
      data: {
        methodType: "METHOD",
        className: classNameToHook,
        methodName: methodNameToHook,
        args: argTypes
      }
    });
    console.error(err);
  }
}

function hookOverloadedMethod(classNameToHook, methodNameToHook){
  var overloadedMethods = classHandle[methodNameToHook].overloads;
  for (var i in overloadedMethods){
    var argTypes = overloadedMethods[i].argumentTypes.map(function(a) {return a.className;});
    try{
      // send message to indicate the overloaded method is being hooked
      send({
        type: "methodHooked",
        data: {
          methodType: "OVERLOADED METHOD",
          className: classNameToHook,
          methodName: methodNameToHook,
          args: argTypes
        }
      });

      classHandle[methodNameToHook].overload.apply(this, argTypes).implementation = function() {

        var args = Array.prototype.slice.call(arguments);
        var retVal = this[methodNameToHook].apply(this, args);
        // send message on hook
        send({
          type: "methodCalled",
          data: {
            methodType: "OVERLOADED METHOD",
            className: classNameToHook,
            methodName: methodNameToHook,
            // argTypes: argTypes,
            // args: JSON.stringify(args)
            args: args + "",
            ret: retVal + ""

          }
        });

        // return this[methodNameToHook].apply(this, args);
        return retVal;
      };
    } catch (err){
      send({
        type: "errorHook",
        data: {
          methodType: "OVERLOADED METHOD",
          className: classNameToHook,
          methodName: methodNameToHook,
          args: argTypes
        }
      });
      console.error(err);
    }
  }
}


/*
CUSTOM FUNCTIONS
*/

/*
return all the property names for an object by walking up the prototype chain
enum/nonenum, self/inherited..
*/
function getAllPropertyNames( obj ) {
    var props = [];

    do {
        props= props.concat(Object.getOwnPropertyNames( obj ));
    } while ( obj = Object.getPrototypeOf( obj ) );

    return props;
}

/*cheap hack to only get the function names of the intended class*/
//TODO do it better I guess
function getAllFunctionNames( propertyNames ) {
  var begin_pos = propertyNames.indexOf("$className");
  var end_pos = propertyNames.indexOf("constructor", begin_pos);
  var functionNames = propertyNames.slice(begin_pos+1, end_pos);
  return functionNames.filter(function(funcName){
    if (typeof(classHandle[funcName]) === "function"){
      return funcName;
    }
  });
}
