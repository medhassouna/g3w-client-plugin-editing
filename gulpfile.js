//Gulp
const gulp   = require('gulp');
const rename = require('gulp-rename');
const source = require('vinyl-source-stream');
const buffer = require('vinyl-buffer');
const gulpif = require('gulp-if');
const uglify = require('gulp-uglify');
const gutil = require("gulp-util");
const browserify = require('browserify');
const babelify = require('babelify');
const watchify = require('watchify');
const stringify = require('stringify');
const sourcemaps = require('gulp-sourcemaps');

gulp.task('browserify', [], function() {
  var production = false;
  var bundler = browserify('./index.js', {
    basedir: "./",
    paths: ["./"],
    debug: !production,
    cache: {},
    packageCache: {}
  });
  if (!production) {
    bundler = watchify(bundler);
  }
  bundler.transform(babelify, {
    babelrc: true
  });
  bundler.transform(stringify, {
    appliesTo: { includeExtensions: ['.html'] }
  });

  var bundle = function(){
    return bundler.bundle()
      .pipe(source('build.js'))
      .pipe(buffer())
      .pipe(gulpif(!production,sourcemaps.init({ loadMaps: true })))
      .pipe(gulpif(production, uglify().on('error', gutil.log)))
      .pipe(gulpif(!production,sourcemaps.write()))
      .pipe(rename('plugin.js'))
      .pipe(gulp.dest('./'));
  };

  var rebundle;

  if (!production) {
    rebundle = function(){
      return bundle();
    };
    bundler.on('update', rebundle);
  }
  else {
    rebundle = function(){
      return bundle();
    }
  }
  return rebundle();
});


gulp.task('production', function(){
    production = true;
});

gulp.task('watch',['browserify']);

gulp.task('default',['production','browserify']);



