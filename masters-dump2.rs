use lila_openingexplorer::{
  db::{Database, DbOpt},
  model::{KeyPrefix, MastersEntry, Stats, write_uint, RawUciMove, GameId},
};
use clap::Parser;
use std::fs::File;
use std::io::{Write, Seek, SeekFrom};
use bytes::{Buf, BufMut};
use std::time::{SystemTime, UNIX_EPOCH};
use time::OffsetDateTime;

const FLAG_RATING_AVG: u16 = 1 << 0;
const FLAG_LAST_YEAR: u16 = 1 << 1;

#[derive(Parser)]
struct Opt {
  #[command(flatten)]
  db: DbOpt,

  /// Output file name
  #[arg(long, default_value = "masters.oe")]
  output: String,

  /// File format version
  #[arg(long, default_value_t = 1)]
  format_version: u16,

  /// Include rating avgs
  #[arg(long)]
  include_rating_avg: bool,

  /// Do not include last year information
  #[arg(long)]
  no_last_year: bool,

  /// Output key size in bytes
  #[arg(long, default_value_t = 8)]
  key_size: usize,
}

struct ExportConfig {
  format_version: u16,
  flags: u16,
  key_size: usize,
  include_rating_avg: bool,
  include_last_year: bool,
}

fn main() -> std::io::Result<()> {
  const MAGIC: &[u8; 4] = b"FCOE";

  let opt = Opt::parse();

  if !matches!(opt.key_size, 8 | 12 | 16) {
    panic!("key size must be 8, 12 or 16 bytes");
  }

  let include_last_year = !opt.no_last_year;

  let mut flags = 0u16;

  if opt.include_rating_avg {
    flags |= FLAG_RATING_AVG;
  }

  if include_last_year {
    flags |= FLAG_LAST_YEAR;
  }

  let config = ExportConfig {
    format_version: opt.format_version,
    flags,
    key_size: opt.key_size,
    include_rating_avg: opt.include_rating_avg,
    include_last_year,
  };

  let revision_id = generate_revision_id();

  let db = Database::open(opt.db).expect("db");
  let masters_db = db.masters();

  let mut record_count = 0;
  let mut pos_count = 0;

  let base_year = OffsetDateTime::now_utc().year() as u16;
  let mut file = File::create(&opt.output)?;
  file.write_all(MAGIC)?;
  file.write_all(&config.format_version.to_le_bytes())?;
  file.write_all(&config.flags.to_le_bytes())?;
  file.write_all(&(config.key_size as u8).to_le_bytes())?;
  file.write_all(&revision_id.to_le_bytes())?;
  let num_entries_pos = file.stream_position()?;
  file.write_all(&0u32.to_le_bytes())?;
  file.write_all(&base_year.to_le_bytes())?;

  let mut written_count: u32 = 0;

  const FLUSH_SIZE: usize = 8 * 1024 * 1024;
  let mut buf = Vec::with_capacity(FLUSH_SIZE);

  let mut curr_prefix: Option<[u8; KeyPrefix::SIZE]> = None;
  let mut curr_entry: Option<MastersEntry> = None;

  for (key, value) in masters_db.iter() {
    let prefix: [u8; KeyPrefix::SIZE] =
      key[..KeyPrefix::SIZE].try_into().unwrap();

    let year = u16::from_be_bytes(
      key[KeyPrefix::SIZE..KeyPrefix::SIZE + 2]
          .try_into()
          .unwrap()
    );

    if curr_prefix != Some(prefix) {
      if let Some(entry) = curr_entry.take() {
        write_pos(
          curr_prefix.as_ref().unwrap(),
          &entry,
          &mut buf,
          base_year,
          &config,
          &mut pos_count,
          &mut written_count,
        );

        if buf.len() >= FLUSH_SIZE {
          file.write_all(&buf)?;
          buf.clear();
        }
      }

      curr_entry = Some(MastersEntry::default());
      curr_prefix = Some(prefix);
    }

    if let Some(entry) = curr_entry.as_mut() {
      let mut value = &value[..];
      extend_entry_from_reader(entry, &mut value, year);
    }

    record_count += 1;
  }

  if let (Some(prefix), Some(entry)) = (curr_prefix.as_ref(), curr_entry) {
    write_pos(
      prefix,
      &entry,
      &mut buf,
      base_year,
      &config,
      &mut pos_count,
      &mut written_count,
    );
  }

  if !buf.is_empty() {
    file.write_all(&buf)?;
  }

  file.seek(SeekFrom::Start(num_entries_pos))?;
  file.write_all(&written_count.to_le_bytes())?;

  println!("Input Entries: {}", record_count);
  println!("Input Positions: {}", pos_count);
  println!("Output Positions: {}", written_count);

  Ok(())
}

fn write_pos(
  prefix: &[u8; KeyPrefix::SIZE],
  entry: &MastersEntry,
  buf: &mut Vec<u8>,
  base_year: u16,
  config: &ExportConfig,
  pos_count: &mut usize,
  written_count: &mut u32,
) {
  *pos_count += 1;

  let mut total = Stats::default();

  for group in entry.groups.values() {
    if group.stats.total() >= 2 {
      total += &group.stats;
    }
  }

  if total.total() == 0 {
    return;
  }

  // Write shortened key
  buf.extend_from_slice(&prefix[..config.key_size]);

  let num_moves = entry.groups
    .values()
    .filter(|group| group.stats.total() >= 2)
    .count() as u8;

  buf.put_u8(num_moves);

  for (uci, group) in &entry.groups {
    if group.stats.total() >= 2 {
      uci.write(buf);

      if config.include_last_year {
        write_uint(
          buf,
          (base_year - group.last_year) as u64
        );
      }

      write_stats(
        &group.stats,
        buf,
        config.include_rating_avg,
      );
    }
  }

  *written_count += 1;
}


fn generate_revision_id() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .expect("System time is before UNIX epoch")
    .as_millis() as u64
}

fn write_stats<B: BufMut>(
  stats: &Stats,
  buf: &mut B,
  include_rating_avg: bool,
) {
  if include_rating_avg {
    write_uint(buf, stats.average_rating().unwrap() as u64);
  }

  let white: u64 = stats.white();
  let draws: u64 = stats.draws();
  let black: u64 = stats.black();

  let compressed = match (white, draws, black) {
    (2, 0, 0) => Some(0),
    (0, 2, 0) => Some(1),
    (0, 0, 2) => Some(2),
    (1, 1, 0) => Some(3),
    (1, 0, 1) => Some(4),
    (0, 1, 1) => Some(5),
    _ => None,
  };

  if let Some(value) = compressed {
    write_uint(buf, value);
  } else {
    write_uint(buf, white + 6);
    write_uint(buf, draws);
    write_uint(buf, black);
  }
}

fn extend_entry_from_reader<B: Buf>(
  entry: &mut MastersEntry,
  buf: &mut B,
  year: u16,
) {
  while buf.has_remaining() {
    let uci = RawUciMove::read(buf);
    let group = entry.groups.entry(uci).or_default();
    group.stats += &Stats::read(buf);
    let num_games = usize::from(buf.get_u8());
    group
      .games
      .extend(
        (0..num_games)
          .map(|_| (buf.get_u16_le(), GameId::read(buf)))
      );

    group.last_year = year;
}
}